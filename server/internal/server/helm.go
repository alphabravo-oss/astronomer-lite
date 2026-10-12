package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage/driver"
	authorizationv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// handleHelm dispatches under /api/clusters/{id}/helm/...
//
// Routes:
//
//	GET    /api/clusters/{id}/helm/releases?namespace=...
//	GET    /api/clusters/{id}/helm/releases/{ns}/{name}
//	GET    /api/clusters/{id}/helm/releases/{ns}/{name}/history
//	POST   /api/clusters/{id}/helm/releases/{ns}/{name}/rollback   {"revision":N}
//	DELETE /api/clusters/{id}/helm/releases/{ns}/{name}
func (s *Server) handleHelm(w http.ResponseWriter, r *http.Request, id string, parts []string) {
	switch {
	case len(parts) == 1 && parts[0] == "repositories" && r.Method == http.MethodGet:
		s.helmRepositories(w, r)
		return
	case len(parts) == 1 && parts[0] == "charts" && r.Method == http.MethodGet:
		s.helmCharts(w, r)
		return
	case len(parts) == 1 && (parts[0] == "install" || parts[0] == "upgrade") && r.Method == http.MethodPost:
		s.helmDeploy(w, r, id, parts[0] == "upgrade")
		return
	case len(parts) == 1 && parts[0] == "releases" && r.Method == http.MethodGet:
		s.helmListReleases(w, r, id)
		return
	case len(parts) == 3 && parts[0] == "releases" && r.Method == http.MethodGet:
		ns, name, err := unescapeNsName(parts[1], parts[2])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.helmGetRelease(w, r, id, ns, name)
		return
	case len(parts) == 3 && parts[0] == "releases" && r.Method == http.MethodDelete:
		ns, name, err := unescapeNsName(parts[1], parts[2])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.helmUninstall(w, r, id, ns, name)
		return
	case len(parts) == 4 && parts[0] == "releases" && parts[3] == "history" && r.Method == http.MethodGet:
		ns, name, err := unescapeNsName(parts[1], parts[2])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.helmHistory(w, r, id, ns, name)
		return
	case len(parts) == 4 && parts[0] == "releases" && parts[3] == "rollback" && r.Method == http.MethodPost:
		ns, name, err := unescapeNsName(parts[1], parts[2])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.helmRollback(w, r, id, ns, name)
		return
	}
	writeError(w, http.StatusNotFound, os.ErrNotExist)
}

func unescapeNsName(rawNs, rawName string) (string, string, error) {
	ns, err := url.PathUnescape(rawNs)
	if err != nil {
		return "", "", err
	}
	name, err := url.PathUnescape(rawName)
	if err != nil {
		return "", "", err
	}
	return ns, name, nil
}

// helmActionConfig wires action.Configuration against the cluster's REST
// config without depending on an on-disk kubeconfig path. The underlying
// REST-client getter (and its memoized discovery + RESTMapper) is cached per
// (cluster, namespace) so repeated Helm requests skip the discovery walk.
func (s *Server) helmActionConfig(id, namespace string) (*action.Configuration, error) {
	getter, err := s.helmGetterFor(id, namespace)
	if err != nil {
		return nil, err
	}
	cfg := new(action.Configuration)
	helmLogger := func(format string, args ...any) {
		log.Printf("helm: "+format, args...)
	}
	if err := cfg.Init(getter, namespace, "secret", helmLogger); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (s *Server) helmGetterFor(id, namespace string) (*restClientGetter, error) {
	key := id + "\x00" + namespace
	s.helmGetterMu.Lock()
	if g, ok := s.helmGetters[key]; ok {
		s.helmGetterMu.Unlock()
		return g, nil
	}
	s.helmGetterMu.Unlock()
	restCfg, err := s.registry.RESTConfig(id)
	if err != nil {
		return nil, err
	}
	getter := newRESTClientGetter(restCfg, namespace)
	s.helmGetterMu.Lock()
	if existing, ok := s.helmGetters[key]; ok {
		s.helmGetterMu.Unlock()
		return existing, nil
	}
	s.helmGetters[key] = getter
	s.helmGetterMu.Unlock()
	return getter, nil
}

type restClientGetter struct {
	cfg       *rest.Config
	namespace string

	mu        sync.Mutex
	discovery discovery.CachedDiscoveryInterface
	mapper    meta.RESTMapper
}

func newRESTClientGetter(cfg *rest.Config, namespace string) *restClientGetter {
	return &restClientGetter{cfg: cfg, namespace: namespace}
}

func (g *restClientGetter) ToRESTConfig() (*rest.Config, error) {
	return rest.CopyConfig(g.cfg), nil
}

func (g *restClientGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.discovery != nil {
		return g.discovery, nil
	}
	dc, err := discovery.NewDiscoveryClientForConfig(g.cfg)
	if err != nil {
		return nil, err
	}
	g.discovery = memory.NewMemCacheClient(dc)
	return g.discovery, nil
}

func (g *restClientGetter) ToRESTMapper() (meta.RESTMapper, error) {
	g.mu.Lock()
	if g.mapper != nil {
		m := g.mapper
		g.mu.Unlock()
		return m, nil
	}
	g.mu.Unlock()
	dc, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	mapper := restmapper.NewDeferredDiscoveryRESTMapper(dc)
	expanded := restmapper.NewShortcutExpander(mapper, dc, nil)
	g.mu.Lock()
	g.mapper = expanded
	g.mu.Unlock()
	return expanded, nil
}

func (g *restClientGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	overrides := &clientcmd.ConfigOverrides{Context: clientcmdapi.Context{Namespace: g.namespace}}
	return clientcmd.NewDefaultClientConfig(*clientcmdapi.NewConfig(), overrides)
}

var _ genericclioptions.RESTClientGetter = (*restClientGetter)(nil)

func (s *Server) helmListReleases(w http.ResponseWriter, r *http.Request, id string) {
	namespace := r.URL.Query().Get("namespace")
	cfg, err := s.helmActionConfig(id, namespace)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	list := action.NewList(cfg)
	list.AllNamespaces = namespace == ""
	list.All = true
	list.Limit = 500
	releases, err := list.Run()
	if err != nil {
		if isHelmStorageMissing(err) {
			writeJSON(w, http.StatusOK, []helmReleaseSummary{})
			return
		}
		writeError(w, http.StatusBadGateway, err)
		return
	}
	out := make([]helmReleaseSummary, 0, len(releases))
	for _, rel := range releases {
		out = append(out, releaseSummary(rel))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) helmGetRelease(w http.ResponseWriter, r *http.Request, id, namespace, name string) {
	cfg, err := s.helmActionConfig(id, namespace)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	get := action.NewGet(cfg)
	rel, err := get.Run(name)
	if err != nil {
		writeError(w, helmStatusForError(err), err)
		return
	}
	writeJSON(w, http.StatusOK, releaseDetail(rel))
}

func (s *Server) helmHistory(w http.ResponseWriter, r *http.Request, id, namespace, name string) {
	cfg, err := s.helmActionConfig(id, namespace)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	hist := action.NewHistory(cfg)
	hist.Max = 50
	releases, err := hist.Run(name)
	if err != nil {
		writeError(w, helmStatusForError(err), err)
		return
	}
	out := make([]helmReleaseSummary, 0, len(releases))
	for _, rel := range releases {
		out = append(out, releaseSummary(rel))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) helmRollback(w http.ResponseWriter, r *http.Request, id, namespace, name string) {
	var body struct {
		Revision int `json:"revision"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.Revision <= 0 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("revision must be a positive integer"))
		return
	}
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Namespace: namespace,
		Verb:      "patch",
		Group:     "",
		Resource:  "secrets",
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	authzCancel()
	cfg, err := s.helmActionConfig(id, namespace)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	roll := action.NewRollback(cfg)
	roll.Version = body.Revision
	roll.Timeout = 5 * time.Minute
	roll.Wait = false
	if err := roll.Run(name); err != nil {
		writeError(w, helmStatusForError(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": name, "revision": body.Revision})
}

func (s *Server) helmUninstall(w http.ResponseWriter, r *http.Request, id, namespace, name string) {
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Namespace: namespace,
		Verb:      "delete",
		Group:     "",
		Resource:  "secrets",
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	authzCancel()
	cfg, err := s.helmActionConfig(id, namespace)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	uninst := action.NewUninstall(cfg)
	uninst.Timeout = 5 * time.Minute
	res, err := uninst.Run(name)
	if err != nil {
		writeError(w, helmStatusForError(err), err)
		return
	}
	resp := map[string]any{"name": name}
	if res != nil && res.Release != nil {
		resp["status"] = string(res.Release.Info.Status)
	}
	writeJSON(w, http.StatusOK, resp)
}

type helmReleaseSummary struct {
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Chart      string `json:"chart"`
	Version    string `json:"version"`
	AppVersion string `json:"appVersion,omitempty"`
	Revision   int    `json:"revision"`
	Status     string `json:"status"`
	Updated    string `json:"updated"`
}

type helmReleaseDetail struct {
	helmReleaseSummary
	Notes    string                 `json:"notes,omitempty"`
	Manifest string                 `json:"manifest,omitempty"`
	Values   map[string]interface{} `json:"values,omitempty"`
	Config   map[string]interface{} `json:"config,omitempty"`
}

func releaseSummary(rel *release.Release) helmReleaseSummary {
	chartName := ""
	chartVersion := ""
	appVersion := ""
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		chartName = rel.Chart.Metadata.Name
		chartVersion = rel.Chart.Metadata.Version
		appVersion = rel.Chart.Metadata.AppVersion
	}
	return helmReleaseSummary{
		Name:       rel.Name,
		Namespace:  rel.Namespace,
		Chart:      chartName,
		Version:    chartVersion,
		AppVersion: appVersion,
		Revision:   rel.Version,
		Status:     string(rel.Info.Status),
		Updated:    rel.Info.LastDeployed.Time.UTC().Format(time.RFC3339),
	}
}

func releaseDetail(rel *release.Release) helmReleaseDetail {
	summary := releaseSummary(rel)
	values := map[string]interface{}{}
	if rel.Chart != nil && rel.Chart.Values != nil {
		values = rel.Chart.Values
	}
	return helmReleaseDetail{
		helmReleaseSummary: summary,
		Notes:              rel.Info.Notes,
		Manifest:           rel.Manifest,
		Values:             values,
		Config:             rel.Config,
	}
}

func isHelmStorageMissing(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, driver.ErrReleaseNotFound) {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "not found") && strings.Contains(msg, "namespace")
}

func helmStatusForError(err error) int {
	if errors.Is(err, driver.ErrReleaseNotFound) {
		return http.StatusNotFound
	}
	return http.StatusBadGateway
}
