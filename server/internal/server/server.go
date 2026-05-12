package server

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"math/rand"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/alphabravo/astronomer-lite/server/internal/cache"
	"github.com/alphabravo/astronomer-lite/server/internal/config"
	"github.com/alphabravo/astronomer-lite/server/internal/kubeconfig"
	"github.com/alphabravo/astronomer-lite/server/internal/plugins"
	"github.com/gorilla/websocket"
	appsv1 "k8s.io/api/apps/v1"
	authorizationv1 "k8s.io/api/authorization/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	k8syaml "k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/tools/remotecommand"
	"k8s.io/client-go/transport/spdy"
	"sigs.k8s.io/yaml"
)

//go:embed static/dist
var embeddedDist embed.FS

type Server struct {
	Config        config.Config
	registry      *kubeconfig.Registry
	logger        *slog.Logger
	portForwardMu sync.Mutex
	portForwards  map[string]*portForwardSession
	informers     *cache.InformerManager
	helmGetterMu  sync.Mutex
	helmGetters   map[string]*restClientGetter
}

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

func New(logger *slog.Logger) (*Server, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	if err := cfg.EnsureDirs(); err != nil {
		return nil, err
	}
	registry := kubeconfig.NewRegistry(config.SystemKubeconfigPath(cfg.Kubeconfig), cfg.ClustersDir, cfg.DisplayFile, logger)
	ctx := context.Background()
	if err := registry.Reload(); err != nil {
		logger.Warn("failed to reload kubeconfigs", "error", err)
	}
	registry.Start(ctx)
	informerMgr := cache.NewInformerManager()
	s := &Server{Config: cfg, registry: registry, logger: logger, portForwards: map[string]*portForwardSession{}, informers: informerMgr, helmGetters: map[string]*restClientGetter{}}
	// Drop per-cluster cached state (openapi, prom detection, informer
	// factories, helm getters) when a kubeconfig disappears or is reloaded
	// so the next request rebuilds from scratch.
	registry.OnClusterInvalidated(func(id string) {
		openAPICache.Invalidate(id)
		promCache.Invalidate(id)
		restMapperCache.Invalidate(id)
		informerMgr.Invalidate(id)
		s.invalidateHelmGetters(id)
	})
	return s, nil
}

func (s *Server) restMapperFor(id string) (meta.RESTMapper, error) {
	return restMapperCache.Do(id, func() (meta.RESTMapper, error) {
		restConfig, err := s.registry.RESTConfig(id)
		if err != nil {
			return nil, err
		}
		discoveryClient, err := discovery.NewDiscoveryClientForConfig(restConfig)
		if err != nil {
			return nil, err
		}
		groupResources, err := restmapper.GetAPIGroupResources(discoveryClient)
		if err != nil {
			return nil, err
		}
		return restmapper.NewDiscoveryRESTMapper(groupResources), nil
	})
}

func (s *Server) invalidateHelmGetters(id string) {
	s.helmGetterMu.Lock()
	defer s.helmGetterMu.Unlock()
	prefix := id + "\x00"
	for key := range s.helmGetters {
		if strings.HasPrefix(key, prefix) {
			delete(s.helmGetters, key)
		}
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/clusters/preview", s.handleKubeconfigPreview)
	mux.HandleFunc("/api/clusters", s.handleClusters)
	mux.HandleFunc("/api/clusters/", s.handleCluster)
	mux.HandleFunc("/api/plugins/nav", s.handlePluginNav)
	mux.Handle("/", s.spaHandler())
	return logRequests(s.logger, mux)
}

func (s *Server) handleClusters(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		clusters := s.registry.List()
		sort.Slice(clusters, func(i, j int) bool {
			return strings.ToLower(clusters[i].Name) < strings.ToLower(clusters[j].Name)
		})
		writeJSON(w, http.StatusOK, clusters)
	case http.MethodPost:
		raw, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		clusters, err := s.registry.AddManaged(raw, splitQueryList(r.URL.Query()["context"]))
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusCreated, clusters)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleKubeconfigPreview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	contexts, err := s.registry.Preview(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"contexts": contexts})
}

func (s *Server) handleCluster(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/clusters/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusNotFound, os.ErrNotExist)
		return
	}
	id := parts[0]
	if _, ok := s.registry.Get(id); !ok {
		writeError(w, http.StatusNotFound, os.ErrNotExist)
		return
	}

	if len(parts) == 1 && r.Method == http.MethodDelete {
		if err := s.registry.Delete(id); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if len(parts) == 2 && parts[1] == "display" && (r.Method == http.MethodPatch || r.Method == http.MethodPut) {
		s.handleClusterDisplay(w, r, id)
		return
	}
	if len(parts) == 2 && parts[1] == "links" && (r.Method == http.MethodPatch || r.Method == http.MethodPut) {
		s.handleClusterLinks(w, r, id)
		return
	}
	if len(parts) == 2 && parts[1] == "workloads-overview" && r.Method == http.MethodGet {
		s.handleWorkloadsOverview(w, r, id)
		return
	}
	if len(parts) == 2 && parts[1] == "topology" && r.Method == http.MethodGet {
		s.handleTopology(w, r, id)
		return
	}
	if len(parts) >= 2 && parts[1] == "prom" {
		s.handleProm(w, r, id, parts[2:])
		return
	}
	if len(parts) == 2 && parts[1] == "dashboard" && r.Method == http.MethodGet {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		dashboard, err := s.registry.Dashboard(ctx, id)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, dashboard)
		return
	}
	if len(parts) == 2 && parts[1] == "can-i" && r.Method == http.MethodPost {
		s.handleAccessReview(w, r, id)
		return
	}
	if len(parts) == 2 && parts[1] == "pods" && r.Method == http.MethodGet {
		s.handlePods(w, r, id)
		return
	}
	if len(parts) == 2 && parts[1] == "namespaces" && r.Method == http.MethodGet {
		s.handleNamespaces(w, r, id)
		return
	}
	if len(parts) == 6 && parts[1] == "secrets" && parts[4] == "reveal" && r.Method == http.MethodGet {
		namespace, err := url.PathUnescape(parts[2])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		name, err := url.PathUnescape(parts[3])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		key, err := url.PathUnescape(parts[5])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handleSecretReveal(w, r, id, namespace, name, key)
		return
	}
	if len(parts) == 2 && parts[1] == "events" && r.Method == http.MethodGet {
		s.handleEvents(w, r, id)
		return
	}
	if len(parts) == 2 && parts[1] == "metrics" && r.Method == http.MethodGet {
		s.handleMetrics(w, r, id)
		return
	}
	if len(parts) == 4 && parts[1] == "nodes" && parts[3] == "drain" && r.Method == http.MethodPost {
		name, err := url.PathUnescape(parts[2])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handleNodeDrain(w, r, id, name)
		return
	}
	if len(parts) == 2 && parts[1] == "portforwards" {
		s.handlePortForwards(w, r, id)
		return
	}
	if len(parts) == 3 && parts[1] == "portforwards" && r.Method == http.MethodDelete {
		sessionID, err := url.PathUnescape(parts[2])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handlePortForwardDelete(w, r, id, sessionID)
		return
	}
	if len(parts) >= 2 && parts[1] == "k8s" {
		s.handleKubernetesProxy(w, r, id, "/"+strings.Join(parts[2:], "/"))
		return
	}
	if len(parts) == 3 && parts[1] == "ws" && parts[2] == "logs" && r.Method == http.MethodGet {
		s.handlePodLogsWS(w, r, id)
		return
	}
	if len(parts) == 3 && parts[1] == "ws" && parts[2] == "exec" && r.Method == http.MethodGet {
		s.handlePodExecWS(w, r, id)
		return
	}
	if len(parts) == 3 && parts[1] == "ws" && parts[2] == "attach" && r.Method == http.MethodGet {
		s.handlePodAttachWS(w, r, id)
		return
	}
	if len(parts) == 3 && parts[1] == "ws" && parts[2] == "watch" && r.Method == http.MethodGet {
		s.handleWatchWS(w, r, id)
		return
	}
	if len(parts) == 2 && parts[1] == "discovery" && r.Method == http.MethodGet {
		s.handleDiscovery(w, r, id)
		return
	}
	if len(parts) == 2 && parts[1] == "openapi" && r.Method == http.MethodGet {
		s.handleOpenAPI(w, r, id)
		return
	}
	if len(parts) == 2 && parts[1] == "search" && r.Method == http.MethodGet {
		s.handleSearch(w, r, id)
		return
	}
	if len(parts) >= 2 && parts[1] == "helm" {
		s.handleHelm(w, r, id, parts[2:])
		return
	}
	if len(parts) == 2 && parts[1] == "apply" && r.Method == http.MethodPost {
		s.handleApply(w, r, id)
		return
	}
	if len(parts) == 2 && parts[1] == "gvr" && r.Method == http.MethodGet {
		s.handleGVRList(w, r, id)
		return
	}
	if len(parts) == 5 && parts[1] == "gvr" && parts[4] == "scale" && r.Method == http.MethodPatch {
		namespace, err := url.PathUnescape(parts[2])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		name, err := url.PathUnescape(parts[3])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handleGVRScale(w, r, id, namespace, name)
		return
	}
	if len(parts) == 4 && parts[1] == "gvr" && r.Method == http.MethodGet {
		namespace, err := url.PathUnescape(parts[2])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		name, err := url.PathUnescape(parts[3])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handleGVRDetail(w, r, id, namespace, name)
		return
	}
	if len(parts) == 4 && parts[1] == "gvr" && r.Method == http.MethodPatch {
		namespace, err := url.PathUnescape(parts[2])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		name, err := url.PathUnescape(parts[3])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handleGVRApply(w, r, id, namespace, name)
		return
	}
	if len(parts) == 4 && parts[1] == "gvr" && r.Method == http.MethodDelete {
		namespace, err := url.PathUnescape(parts[2])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		name, err := url.PathUnescape(parts[3])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handleGVRDelete(w, r, id, namespace, name)
		return
	}
	if len(parts) == 3 && parts[1] == "resources" && r.Method == http.MethodGet {
		s.handleResourceList(w, r, id, parts[2])
		return
	}
	if len(parts) == 6 && parts[1] == "resources" && parts[5] == "scale" && r.Method == http.MethodPatch {
		resource := parts[2]
		namespace, err := url.PathUnescape(parts[3])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		name, err := url.PathUnescape(parts[4])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handleResourceScale(w, r, id, resource, namespace, name)
		return
	}
	if len(parts) == 6 && parts[1] == "resources" && parts[5] == "rollback" && r.Method == http.MethodPost {
		resource := parts[2]
		namespace, err := url.PathUnescape(parts[3])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		name, err := url.PathUnescape(parts[4])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handleResourceRollback(w, r, id, resource, namespace, name)
		return
	}
	if len(parts) == 5 && parts[1] == "resources" && r.Method == http.MethodGet {
		resource := parts[2]
		namespace, err := url.PathUnescape(parts[3])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		name, err := url.PathUnescape(parts[4])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handleResourceDetail(w, r, id, resource, namespace, name)
		return
	}
	if len(parts) == 5 && parts[1] == "resources" && r.Method == http.MethodPatch {
		resource := parts[2]
		namespace, err := url.PathUnescape(parts[3])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		name, err := url.PathUnescape(parts[4])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handleResourceApply(w, r, id, resource, namespace, name)
		return
	}
	if len(parts) == 5 && parts[1] == "resources" && r.Method == http.MethodDelete {
		resource := parts[2]
		namespace, err := url.PathUnescape(parts[3])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		name, err := url.PathUnescape(parts[4])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handleResourceDelete(w, r, id, resource, namespace, name)
		return
	}
	if len(parts) == 4 && parts[1] == "pods" && r.Method == http.MethodGet {
		namespace, err := url.PathUnescape(parts[2])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		name, err := url.PathUnescape(parts[3])
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.handlePodDetail(w, r, id, namespace, name)
		return
	}
	writeError(w, http.StatusNotFound, os.ErrNotExist)
}

func (s *Server) handlePods(w http.ResponseWriter, r *http.Request, id string) {
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	namespaces := splitQueryList(r.URL.Query()["namespace"])
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	type podRow struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
		Status    string `json:"status"`
		Restarts  int32  `json:"restarts"`
		Age       string `json:"age"`
		Node      string `json:"node"`
		Ready     string `json:"ready"`
		IP        string `json:"ip"`
	}
	rows := []podRow{}
	listNamespaces := namespaces
	if len(listNamespaces) == 0 {
		listNamespaces = []string{""}
	}
	for _, namespace := range listNamespaces {
		pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		for _, pod := range pods.Items {
			var restarts int32
			ready := 0
			for _, status := range pod.Status.ContainerStatuses {
				restarts += status.RestartCount
				if status.Ready {
					ready++
				}
			}
			rows = append(rows, podRow{
				Name:      pod.Name,
				Namespace: pod.Namespace,
				Status:    string(pod.Status.Phase),
				Restarts:  restarts,
				Age:       time.Since(pod.CreationTimestamp.Time).Round(time.Second).String(),
				Node:      pod.Spec.NodeName,
				Ready:     strconvPair(ready, len(pod.Spec.Containers)),
				IP:        pod.Status.PodIP,
			})
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Namespace == rows[j].Namespace {
			return rows[i].Name < rows[j].Name
		}
		return rows[i].Namespace < rows[j].Namespace
	})
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) handleClusterDisplay(w http.ResponseWriter, r *http.Request, id string) {
	var payload struct {
		Color    string `json:"color"`
		Initials string `json:"initials"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	cluster, err := s.registry.SetDisplay(id, payload.Color, payload.Initials)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, cluster)
}

func (s *Server) handleClusterLinks(w http.ResponseWriter, r *http.Request, id string) {
	var payload struct {
		Links []kubeconfig.ClusterLink `json:"links"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	cluster, err := s.registry.SetLinks(id, payload.Links)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, cluster)
}

func (s *Server) handleNamespaces(w http.ResponseWriter, r *http.Request, id string) {
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	namespaces, err := client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	type namespaceRow struct {
		Name   string `json:"name"`
		Status string `json:"status"`
		Age    string `json:"age"`
	}
	rows := make([]namespaceRow, 0, len(namespaces.Items))
	for _, namespace := range namespaces.Items {
		rows = append(rows, namespaceRow{
			Name:   namespace.Name,
			Status: string(namespace.Status.Phase),
			Age:    time.Since(namespace.CreationTimestamp.Time).Round(time.Second).String(),
		})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })
	writeJSON(w, http.StatusOK, rows)
}

type accessReviewRequest struct {
	Verb        string `json:"verb"`
	Group       string `json:"group"`
	Resource    string `json:"resource"`
	Subresource string `json:"subresource,omitempty"`
	Namespace   string `json:"namespace,omitempty"`
	Name        string `json:"name,omitempty"`
}

type accessReviewResponse struct {
	Allowed         bool   `json:"allowed"`
	Denied          bool   `json:"denied"`
	Reason          string `json:"reason,omitempty"`
	EvaluationError string `json:"evaluationError,omitempty"`
}

func (s *Server) handleAccessReview(w http.ResponseWriter, r *http.Request, id string) {
	var body accessReviewRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	body.Verb = strings.TrimSpace(body.Verb)
	body.Group = strings.TrimSpace(body.Group)
	body.Resource = strings.TrimSpace(body.Resource)
	body.Subresource = strings.TrimSpace(body.Subresource)
	body.Namespace = strings.TrimSpace(body.Namespace)
	body.Name = strings.TrimSpace(body.Name)
	if body.Namespace == "_" {
		body.Namespace = ""
	}
	if body.Verb == "" || body.Resource == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("verb and resource are required"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	status, err := s.selfSubjectAccessReview(ctx, id, authorizationv1.ResourceAttributes{
		Namespace:   body.Namespace,
		Verb:        body.Verb,
		Group:       body.Group,
		Resource:    body.Resource,
		Subresource: body.Subresource,
		Name:        body.Name,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, accessReviewResponse{
		Allowed:         status.Allowed,
		Denied:          status.Denied,
		Reason:          status.Reason,
		EvaluationError: status.EvaluationError,
	})
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request, id string) {
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	def := resourceDefinitions["events"]
	namespaces := splitQueryList(r.URL.Query()["namespace"])
	if len(namespaces) == 0 {
		namespaces = []string{""}
	}
	rows := []eventRow{}
	for _, namespace := range namespaces {
		resourceClient := resourceClientFor(client, def, namespace)
		list, err := resourceClient.List(ctx, metav1.ListOptions{})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		for _, item := range list.Items {
			rows = append(rows, eventRowFromObject(item.Object))
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].LastTimestamp > rows[j].LastTimestamp
	})
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) handleSecretReveal(w http.ResponseWriter, r *http.Request, id string, namespace string, name string, key string) {
	if namespace == "" || namespace == "_" || name == "" || key == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("namespace, secret name, and key are required"))
		return
	}
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Namespace: namespace,
		Verb:      "get",
		Group:     "",
		Resource:  "secrets",
		Name:      name,
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	authzCancel()
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	secret, err := client.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	value, ok := secret.Data[key]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("secret key %q not found", key))
		return
	}
	response := map[string]any{
		"key":    key,
		"base64": base64.StdEncoding.EncodeToString(value),
		"binary": !utf8.Valid(value),
	}
	if utf8.Valid(value) {
		response["value"] = string(value)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request, id string) {
	dynamicClient, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	typedClient, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	nodeMetrics, err := dynamicClient.Resource(schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "nodes"}).List(ctx, metav1.ListOptions{})
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"available": false,
			"error":     err.Error(),
			"nodes":     []metricsRow{},
			"pods":      []metricsRow{},
		})
		return
	}
	podMetrics, err := dynamicClient.Resource(schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "pods"}).List(ctx, metav1.ListOptions{})
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"available": false,
			"error":     err.Error(),
			"nodes":     []metricsRow{},
			"pods":      []metricsRow{},
		})
		return
	}

	nodes, err := typedClient.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	capacityByNode := map[string]struct {
		cpuMilli   int64
		memoryByte int64
	}{}
	for _, node := range nodes.Items {
		capacityByNode[node.Name] = struct {
			cpuMilli   int64
			memoryByte int64
		}{
			cpuMilli:   node.Status.Allocatable.Cpu().MilliValue(),
			memoryByte: node.Status.Allocatable.Memory().Value(),
		}
	}

	nodeRows := make([]metricsRow, 0, len(nodeMetrics.Items))
	var totalCPU int64
	var totalMemory int64
	var totalCapacityCPU int64
	var totalCapacityMemory int64
	for _, item := range nodeMetrics.Items {
		cpu := metricQuantityMilli(item.Object, "usage", "cpu")
		memory := metricQuantityBytes(item.Object, "usage", "memory")
		capacity := capacityByNode[item.GetName()]
		totalCPU += cpu
		totalMemory += memory
		totalCapacityCPU += capacity.cpuMilli
		totalCapacityMemory += capacity.memoryByte
		nodeRows = append(nodeRows, metricsRow{
			Name:              item.GetName(),
			CPU:               cpu,
			Memory:            memory,
			CPUPercent:        percent(cpu, capacity.cpuMilli),
			MemoryPercent:     percent(memory, capacity.memoryByte),
			Window:            stringFromMap(item.Object, "window"),
			Timestamp:         stringFromMap(item.Object, "timestamp"),
			CapacityCPU:       capacity.cpuMilli,
			CapacityMemory:    capacity.memoryByte,
			Namespace:         item.GetNamespace(),
			ContainerCount:    0,
			RegardingResource: "node",
		})
	}

	podRows := make([]metricsRow, 0, len(podMetrics.Items))
	for _, item := range podMetrics.Items {
		containers, _, _ := unstructured.NestedSlice(item.Object, "containers")
		var cpu int64
		var memory int64
		for _, container := range containers {
			containerMap, ok := container.(map[string]any)
			if !ok {
				continue
			}
			cpu += metricQuantityMilli(containerMap, "usage", "cpu")
			memory += metricQuantityBytes(containerMap, "usage", "memory")
		}
		podRows = append(podRows, metricsRow{
			Name:              item.GetName(),
			Namespace:         item.GetNamespace(),
			CPU:               cpu,
			Memory:            memory,
			Window:            stringFromMap(item.Object, "window"),
			Timestamp:         stringFromMap(item.Object, "timestamp"),
			ContainerCount:    int64(len(containers)),
			RegardingResource: "pod",
		})
	}
	sort.Slice(nodeRows, func(i, j int) bool {
		if nodeRows[i].CPU == nodeRows[j].CPU {
			return nodeRows[i].Name < nodeRows[j].Name
		}
		return nodeRows[i].CPU > nodeRows[j].CPU
	})
	sort.Slice(podRows, func(i, j int) bool {
		if podRows[i].CPU == podRows[j].CPU {
			return podRows[i].Name < podRows[j].Name
		}
		return podRows[i].CPU > podRows[j].CPU
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"available":           true,
		"nodeCount":           len(nodeRows),
		"podCount":            len(podRows),
		"totalCPU":            totalCPU,
		"totalMemory":         totalMemory,
		"totalCapacityCPU":    totalCapacityCPU,
		"totalCapacityMemory": totalCapacityMemory,
		"cpuPercent":          percent(totalCPU, totalCapacityCPU),
		"memoryPercent":       percent(totalMemory, totalCapacityMemory),
		"nodes":               nodeRows,
		"pods":                podRows,
	})
}

type nodeDrainRequest struct {
	Force              bool `json:"force"`
	DeleteEmptyDirData bool `json:"deleteEmptyDirData"`
}

type nodeDrainPodResult struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Reason    string `json:"reason,omitempty"`
	Error     string `json:"error,omitempty"`
}

type nodeDrainResponse struct {
	NodeCordoned    bool                 `json:"nodeCordoned"`
	NodeWasCordoned bool                 `json:"nodeWasCordoned"`
	Evicted         []nodeDrainPodResult `json:"evicted"`
	Skipped         []nodeDrainPodResult `json:"skipped"`
	Errors          []nodeDrainPodResult `json:"errors"`
}

func (s *Server) handleNodeDrain(w http.ResponseWriter, r *http.Request, id string, name string) {
	var request nodeDrainRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Verb:     "patch",
		Group:    "",
		Resource: "nodes",
		Name:     name,
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Verb:        "create",
		Group:       "",
		Resource:    "pods",
		Subresource: "eviction",
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	authzCancel()
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	node, err := client.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	response := nodeDrainResponse{
		NodeCordoned:    true,
		NodeWasCordoned: node.Spec.Unschedulable,
		Evicted:         []nodeDrainPodResult{},
		Skipped:         []nodeDrainPodResult{},
		Errors:          []nodeDrainPodResult{},
	}
	if !node.Spec.Unschedulable {
		next := node.DeepCopy()
		next.Spec.Unschedulable = true
		if _, err := client.CoreV1().Nodes().Update(ctx, next, metav1.UpdateOptions{}); err != nil {
			writeError(w, http.StatusBadGateway, fmt.Errorf("cordon node before drain: %w", err))
			return
		}
	}

	pods, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: fields.OneTermEqualSelector("spec.nodeName", name).String(),
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	for _, pod := range pods.Items {
		ref := nodeDrainPodResult{Namespace: pod.Namespace, Name: pod.Name}
		if reason := nodeDrainSkipReason(pod, request); reason != "" {
			ref.Reason = reason
			response.Skipped = append(response.Skipped, ref)
			continue
		}

		eviction := &policyv1.Eviction{
			ObjectMeta: metav1.ObjectMeta{Name: pod.Name, Namespace: pod.Namespace},
		}
		if err := client.PolicyV1().Evictions(pod.Namespace).Evict(ctx, eviction); err != nil {
			ref.Error = err.Error()
			response.Errors = append(response.Errors, ref)
			continue
		}
		response.Evicted = append(response.Evicted, ref)
	}
	writeJSON(w, http.StatusOK, response)
}

func nodeDrainSkipReason(pod corev1.Pod, request nodeDrainRequest) string {
	if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
		return "Pod is already completed"
	}
	if _, ok := pod.Annotations[corev1.MirrorPodAnnotationKey]; ok {
		return "Static mirror Pods cannot be evicted"
	}
	controller := metav1.GetControllerOf(&pod)
	if controller != nil && controller.Kind == "DaemonSet" {
		return "DaemonSet-managed Pods are ignored during drain"
	}
	if controller == nil && !request.Force {
		return "Pod has no controller; enable force to evict unmanaged Pods"
	}
	if podUsesEmptyDir(pod) && !request.DeleteEmptyDirData {
		return "Pod uses emptyDir data; allow emptyDir deletion to evict it"
	}
	return ""
}

func podUsesEmptyDir(pod corev1.Pod) bool {
	for _, volume := range pod.Spec.Volumes {
		if volume.EmptyDir != nil {
			return true
		}
	}
	return false
}

type portForwardRequest struct {
	Namespace    string `json:"namespace"`
	Pod          string `json:"pod"`
	ResourceKind string `json:"resourceKind,omitempty"`
	ResourceName string `json:"resourceName,omitempty"`
	LocalPort    int    `json:"localPort"`
	RemotePort   int    `json:"remotePort"`
}

type portForwardRow struct {
	ID           string `json:"id"`
	ClusterID    string `json:"clusterId"`
	Namespace    string `json:"namespace"`
	Pod          string `json:"pod"`
	ResourceKind string `json:"resourceKind"`
	ResourceName string `json:"resourceName"`
	LocalPort    int    `json:"localPort"`
	RemotePort   int    `json:"remotePort"`
	URL          string `json:"url"`
	CreatedAt    string `json:"createdAt"`
	ExpiresAt    string `json:"expiresAt,omitempty"`
	Error        string `json:"error,omitempty"`
}

type portForwardSession struct {
	row      portForwardRow
	stop     chan struct{}
	done     chan struct{}
	stopOnce sync.Once
}

func (session *portForwardSession) stopForward() {
	session.stopOnce.Do(func() {
		close(session.stop)
	})
}

func (s *Server) handlePortForwards(w http.ResponseWriter, r *http.Request, id string) {
	switch r.Method {
	case http.MethodGet:
		s.portForwardMu.Lock()
		rows := []portForwardRow{}
		for _, session := range s.portForwards {
			if session.row.ClusterID == id {
				rows = append(rows, session.row)
			}
		}
		s.portForwardMu.Unlock()
		sort.Slice(rows, func(i, j int) bool { return rows[i].CreatedAt > rows[j].CreatedAt })
		writeJSON(w, http.StatusOK, rows)
	case http.MethodPost:
		var request portForwardRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
		if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
			Namespace:   request.Namespace,
			Verb:        "create",
			Group:       "",
			Resource:    "pods",
			Subresource: "portforward",
		}); err != nil {
			authzCancel()
			writeError(w, http.StatusBadGateway, err)
			return
		}
		authzCancel()
		row, err := s.startPortForward(r.Context(), id, request)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusCreated, row)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handlePortForwardDelete(w http.ResponseWriter, _ *http.Request, id string, sessionID string) {
	s.portForwardMu.Lock()
	session, ok := s.portForwards[sessionID]
	if ok && session.row.ClusterID == id {
		delete(s.portForwards, sessionID)
	}
	s.portForwardMu.Unlock()
	if !ok || session.row.ClusterID != id {
		writeError(w, http.StatusNotFound, os.ErrNotExist)
		return
	}
	session.stopForward()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) startPortForward(ctx context.Context, id string, request portForwardRequest) (portForwardRow, error) {
	namespace := strings.TrimSpace(request.Namespace)
	pod := strings.TrimSpace(request.Pod)
	resourceKind := strings.ToLower(strings.TrimSpace(request.ResourceKind))
	resourceName := strings.TrimSpace(request.ResourceName)
	if resourceKind == "" {
		resourceKind = "pod"
	}
	if resourceName == "" {
		resourceName = pod
	}
	if namespace == "" || resourceName == "" {
		return portForwardRow{}, fmt.Errorf("namespace and resource name are required")
	}
	if resourceKind != "pod" && resourceKind != "service" {
		return portForwardRow{}, fmt.Errorf("resourceKind must be pod or service")
	}
	if request.RemotePort <= 0 || request.RemotePort > 65535 {
		return portForwardRow{}, fmt.Errorf("remotePort must be between 1 and 65535")
	}
	targetPort := request.RemotePort
	if resourceKind == "service" {
		client, err := s.registry.Client(id)
		if err != nil {
			return portForwardRow{}, err
		}
		resolvedPod, resolvedPort, err := resolveServicePortForwardTarget(ctx, client, namespace, resourceName, request.RemotePort)
		if err != nil {
			return portForwardRow{}, err
		}
		pod = resolvedPod
		targetPort = resolvedPort
	} else if pod == "" {
		return portForwardRow{}, fmt.Errorf("namespace and pod are required")
	}
	localPort := request.LocalPort
	if localPort == 0 {
		nextPort, err := freeLocalPort()
		if err != nil {
			return portForwardRow{}, err
		}
		localPort = nextPort
	}
	if localPort <= 0 || localPort > 65535 {
		return portForwardRow{}, fmt.Errorf("localPort must be between 1 and 65535")
	}
	cfg, err := s.registry.RESTConfig(id)
	if err != nil {
		return portForwardRow{}, err
	}
	transport, upgrader, err := spdy.RoundTripperFor(cfg)
	if err != nil {
		return portForwardRow{}, err
	}
	hostURL, err := url.Parse(cfg.Host)
	if err != nil {
		return portForwardRow{}, err
	}
	hostURL.Path = path.Join(hostURL.Path, "api", "v1", "namespaces", namespace, "pods", pod, "portforward")
	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: transport}, http.MethodPost, hostURL)
	stopChan := make(chan struct{})
	readyChan := make(chan struct{})
	doneChan := make(chan struct{})
	errChan := make(chan error, 1)
	forwarder, err := portforward.NewOnAddresses(
		dialer,
		[]string{"127.0.0.1"},
		[]string{fmt.Sprintf("%d:%d", localPort, targetPort)},
		stopChan,
		readyChan,
		io.Discard,
		io.Discard,
	)
	if err != nil {
		return portForwardRow{}, err
	}
	sessionID := fmt.Sprintf("pf-%d-%d", time.Now().UnixNano(), rand.Intn(100000))
	now := time.Now()
	expiresAt := ""
	if s.Config.PortForwardTTL > 0 {
		expiresAt = now.Add(s.Config.PortForwardTTL).Format(time.RFC3339Nano)
	}
	row := portForwardRow{
		ID:           sessionID,
		ClusterID:    id,
		Namespace:    namespace,
		Pod:          pod,
		ResourceKind: resourceKind,
		ResourceName: resourceName,
		LocalPort:    localPort,
		RemotePort:   request.RemotePort,
		URL:          fmt.Sprintf("http://127.0.0.1:%d", localPort),
		CreatedAt:    now.Format(time.RFC3339Nano),
		ExpiresAt:    expiresAt,
	}
	session := &portForwardSession{row: row, stop: stopChan, done: doneChan}
	go func() {
		defer close(doneChan)
		if err := forwarder.ForwardPorts(); err != nil {
			errChan <- err
			s.portForwardMu.Lock()
			if current, ok := s.portForwards[sessionID]; ok {
				current.row.Error = err.Error()
			}
			s.portForwardMu.Unlock()
		}
		s.portForwardMu.Lock()
		delete(s.portForwards, sessionID)
		s.portForwardMu.Unlock()
	}()
	select {
	case <-readyChan:
		s.portForwardMu.Lock()
		s.portForwards[sessionID] = session
		s.portForwardMu.Unlock()
		if s.Config.PortForwardTTL > 0 {
			go func() {
				timer := time.NewTimer(s.Config.PortForwardTTL)
				defer timer.Stop()
				select {
				case <-timer.C:
					session.stopForward()
				case <-session.done:
				}
			}()
		}
		return row, nil
	case err := <-errChan:
		session.stopForward()
		return portForwardRow{}, err
	case <-ctx.Done():
		session.stopForward()
		return portForwardRow{}, ctx.Err()
	case <-time.After(10 * time.Second):
		session.stopForward()
		return portForwardRow{}, fmt.Errorf("timed out waiting for port-forward")
	}
}

func resolveServicePortForwardTarget(ctx context.Context, client *kubernetes.Clientset, namespace string, serviceName string, servicePort int) (string, int, error) {
	service, err := client.CoreV1().Services(namespace).Get(ctx, serviceName, metav1.GetOptions{})
	if err != nil {
		return "", 0, err
	}
	if len(service.Spec.Selector) == 0 {
		return "", 0, fmt.Errorf("service %q has no selector", serviceName)
	}
	targetPort := servicePort
	var targetName string
	for _, port := range service.Spec.Ports {
		if int(port.Port) != servicePort {
			continue
		}
		if port.TargetPort.Type == intstr.String {
			targetName = port.TargetPort.StrVal
		} else if port.TargetPort.IntVal > 0 {
			targetPort = int(port.TargetPort.IntVal)
		}
		break
	}
	selector := labels.SelectorFromSet(service.Spec.Selector).String()
	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return "", 0, err
	}
	for _, pod := range pods.Items {
		if pod.Status.Phase != corev1.PodRunning {
			continue
		}
		if targetName != "" {
			if namedPort, ok := containerPortByName(pod, targetName); ok {
				return pod.Name, namedPort, nil
			}
			continue
		}
		return pod.Name, targetPort, nil
	}
	if targetName != "" {
		return "", 0, fmt.Errorf("no running pod behind service %q exposes named targetPort %q", serviceName, targetName)
	}
	return "", 0, fmt.Errorf("no running pods found behind service %q", serviceName)
}

func containerPortByName(pod corev1.Pod, name string) (int, bool) {
	for _, container := range pod.Spec.Containers {
		for _, port := range container.Ports {
			if port.Name == name && port.ContainerPort > 0 {
				return int(port.ContainerPort), true
			}
		}
	}
	return 0, false
}

func freeLocalPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return 0, fmt.Errorf("unexpected listener address %s", listener.Addr().String())
	}
	return address.Port, nil
}

func (s *Server) handlePodDetail(w http.ResponseWriter, r *http.Request, id string, namespace string, name string) {
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	pod, err := client.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	type containerRow struct {
		Name       string            `json:"name"`
		Image      string            `json:"image"`
		Ready      bool              `json:"ready"`
		Restarts   int32             `json:"restarts"`
		State      string            `json:"state"`
		Ports      []int32           `json:"ports,omitempty"`
		Requests   map[string]string `json:"requests,omitempty"`
		Limits     map[string]string `json:"limits,omitempty"`
		PullPolicy string            `json:"pullPolicy,omitempty"`
	}
	type volumeRow struct {
		Name string `json:"name"`
		Type string `json:"type"`
	}
	type tolerationRow struct {
		Key               string `json:"key,omitempty"`
		Value             string `json:"value,omitempty"`
		Operator          string `json:"operator,omitempty"`
		Effect            string `json:"effect,omitempty"`
		TolerationSeconds *int64 `json:"tolerationSeconds,omitempty"`
	}
	type ownerReferenceRow struct {
		APIVersion string `json:"apiVersion"`
		Kind       string `json:"kind"`
		Name       string `json:"name"`
		UID        string `json:"uid,omitempty"`
		Controller bool   `json:"controller,omitempty"`
	}
	type conditionRow struct {
		Type    string `json:"type"`
		Status  string `json:"status"`
		Reason  string `json:"reason,omitempty"`
		Message string `json:"message,omitempty"`
	}
	statusByName := map[string]containerRow{}
	for _, status := range pod.Status.ContainerStatuses {
		state := "waiting"
		if status.State.Running != nil {
			state = "running"
		} else if status.State.Terminated != nil {
			state = "terminated"
		}
		statusByName[status.Name] = containerRow{
			Name: status.Name, Image: status.Image, Ready: status.Ready, Restarts: status.RestartCount, State: state,
		}
	}
	containers := make([]containerRow, 0, len(pod.Spec.Containers))
	for _, container := range pod.Spec.Containers {
		row, ok := statusByName[container.Name]
		if !ok {
			row = containerRow{Name: container.Name, Image: container.Image, State: "pending"}
		}
		row.PullPolicy = string(container.ImagePullPolicy)
		row.Requests = resourceListStrings(container.Resources.Requests)
		row.Limits = resourceListStrings(container.Resources.Limits)
		for _, port := range container.Ports {
			row.Ports = append(row.Ports, port.ContainerPort)
		}
		containers = append(containers, row)
	}
	initContainers := make([]containerRow, 0, len(pod.Spec.InitContainers))
	for _, container := range pod.Spec.InitContainers {
		row := containerRow{Name: container.Name, Image: container.Image, State: "init", PullPolicy: string(container.ImagePullPolicy), Requests: resourceListStrings(container.Resources.Requests), Limits: resourceListStrings(container.Resources.Limits)}
		for _, port := range container.Ports {
			row.Ports = append(row.Ports, port.ContainerPort)
		}
		initContainers = append(initContainers, row)
	}
	volumes := make([]volumeRow, 0, len(pod.Spec.Volumes))
	for _, volume := range pod.Spec.Volumes {
		volumes = append(volumes, volumeRow{Name: volume.Name, Type: podVolumeType(volume)})
	}
	tolerations := make([]tolerationRow, 0, len(pod.Spec.Tolerations))
	for _, toleration := range pod.Spec.Tolerations {
		tolerations = append(tolerations, tolerationRow{
			Key: toleration.Key, Value: toleration.Value, Operator: string(toleration.Operator), Effect: string(toleration.Effect), TolerationSeconds: toleration.TolerationSeconds,
		})
	}
	ownerReferences := make([]ownerReferenceRow, 0, len(pod.OwnerReferences))
	for _, owner := range pod.OwnerReferences {
		ownerReferences = append(ownerReferences, ownerReferenceRow{
			APIVersion: owner.APIVersion,
			Kind:       owner.Kind,
			Name:       owner.Name,
			UID:        string(owner.UID),
			Controller: owner.Controller != nil && *owner.Controller,
		})
	}
	podIPs := make([]string, 0, len(pod.Status.PodIPs))
	for _, ip := range pod.Status.PodIPs {
		podIPs = append(podIPs, ip.IP)
	}
	hostIPs := make([]string, 0, len(pod.Status.HostIPs))
	for _, ip := range pod.Status.HostIPs {
		hostIPs = append(hostIPs, ip.IP)
	}
	conditions := make([]conditionRow, 0, len(pod.Status.Conditions))
	for _, condition := range pod.Status.Conditions {
		conditions = append(conditions, conditionRow{
			Type: string(condition.Type), Status: string(condition.Status), Reason: condition.Reason, Message: condition.Message,
		})
	}
	var restarts int32
	ready := 0
	for _, status := range pod.Status.ContainerStatuses {
		restarts += status.RestartCount
		if status.Ready {
			ready++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"name":               pod.Name,
		"namespace":          pod.Namespace,
		"uid":                string(pod.UID),
		"status":             string(pod.Status.Phase),
		"ready":              strconvPair(ready, len(pod.Spec.Containers)),
		"restarts":           restarts,
		"age":                time.Since(pod.CreationTimestamp.Time).Round(time.Second).String(),
		"createdAt":          pod.CreationTimestamp.Time.Format(time.RFC3339),
		"node":               pod.Spec.NodeName,
		"podIP":              pod.Status.PodIP,
		"podIPs":             podIPs,
		"hostIP":             pod.Status.HostIP,
		"hostIPs":            hostIPs,
		"serviceAccountName": pod.Spec.ServiceAccountName,
		"qosClass":           string(pod.Status.QOSClass),
		"priority":           pod.Spec.Priority,
		"labels":             pod.Labels,
		"annotations":        pod.Annotations,
		"ownerReferences":    ownerReferences,
		"containers":         containers,
		"initContainers":     initContainers,
		"volumes":            volumes,
		"tolerations":        tolerations,
		"conditions":         conditions,
	})
}

func resourceListStrings(values corev1.ResourceList) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		result[string(key)] = value.String()
	}
	return result
}

func podVolumeType(volume corev1.Volume) string {
	switch {
	case volume.ConfigMap != nil:
		return "ConfigMap"
	case volume.Secret != nil:
		return "Secret"
	case volume.PersistentVolumeClaim != nil:
		return "PersistentVolumeClaim"
	case volume.EmptyDir != nil:
		return "EmptyDir"
	case volume.Projected != nil:
		return "Projected"
	case volume.DownwardAPI != nil:
		return "DownwardAPI"
	case volume.HostPath != nil:
		return "HostPath"
	case volume.CSI != nil:
		return "CSI"
	case volume.Ephemeral != nil:
		return "Ephemeral"
	default:
		return "Other"
	}
}

type logFrame struct {
	Type      string `json:"type"`
	Message   string `json:"message,omitempty"`
	Timestamp string `json:"timestamp,omitempty"`
}

func (s *Server) handlePodLogsWS(w http.ResponseWriter, r *http.Request, id string) {
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	query := r.URL.Query()
	namespace := strings.TrimSpace(query.Get("ns"))
	pod := strings.TrimSpace(query.Get("pod"))
	if namespace == "" || pod == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("ns and pod query parameters are required"))
		return
	}
	tailLines := int64(100)
	if value := strings.TrimSpace(query.Get("tailLines")); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, fmt.Errorf("tailLines must be a non-negative integer"))
			return
		}
		tailLines = parsed
	}
	options := &corev1.PodLogOptions{
		Container:  query.Get("container"),
		Follow:     query.Get("follow") != "false",
		TailLines:  &tailLines,
		Timestamps: query.Get("timestamps") == "true",
	}
	var sinceTimeValue time.Time
	var hasSinceTime bool
	if value := strings.TrimSpace(query.Get("sinceTime")); value != "" {
		parsed, err := time.Parse(time.RFC3339Nano, value)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("sinceTime must be RFC3339Nano: %w", err))
			return
		}
		sinceTimeValue = parsed
		hasSinceTime = true
		sinceTime := metav1.NewTime(parsed)
		options.SinceTime = &sinceTime
		options.TailLines = nil
	}
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	stream, err := client.CoreV1().Pods(namespace).GetLogs(pod, options).Stream(ctx)
	if err != nil {
		_ = conn.WriteJSON(logFrame{Type: "error", Message: err.Error()})
		return
	}
	defer stream.Close()

	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		frame := logLineFrame(scanner.Text(), options.Timestamps)
		if hasSinceTime && frame.Timestamp != "" {
			timestamp, err := time.Parse(time.RFC3339Nano, frame.Timestamp)
			if err == nil && !timestamp.After(sinceTimeValue) {
				continue
			}
		}
		if err := conn.WriteJSON(frame); err != nil {
			return
		}
	}
	if err := scanner.Err(); err != nil && !errors.Is(ctx.Err(), context.Canceled) {
		_ = conn.WriteJSON(logFrame{Type: "error", Message: err.Error()})
		return
	}
	_ = conn.WriteJSON(logFrame{Type: "end"})
}

func logLineFrame(line string, timestamps bool) logFrame {
	frame := logFrame{Type: "line", Message: line}
	if !timestamps {
		return frame
	}
	timestamp, message, ok := strings.Cut(line, " ")
	if !ok {
		return frame
	}
	if _, err := time.Parse(time.RFC3339Nano, timestamp); err != nil {
		return frame
	}
	frame.Timestamp = timestamp
	frame.Message = message
	return frame
}

type execFrame struct {
	Type    string `json:"type"`
	Message string `json:"message,omitempty"`
}

type execControlFrame struct {
	Type string `json:"type"`
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

func (s *Server) handlePodExecWS(w http.ResponseWriter, r *http.Request, id string) {
	cfg, err := s.registry.RESTConfig(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	query := r.URL.Query()
	namespace := strings.TrimSpace(query.Get("ns"))
	pod := strings.TrimSpace(query.Get("pod"))
	if namespace == "" || pod == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("ns and pod query parameters are required"))
		return
	}
	command := splitCommand(query["command"])
	if len(command) == 0 {
		command = []string{"/bin/sh"}
	}
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stream := newExecWebSocketStream(conn, cancel)
	go stream.readLoop()

	execConfig := rest.CopyConfig(cfg)
	execConfig.APIPath = "/api"
	execConfig.GroupVersion = &corev1.SchemeGroupVersion
	execConfig.NegotiatedSerializer = scheme.Codecs.WithoutConversion()

	restClient, err := rest.RESTClientFor(execConfig)
	if err != nil {
		_ = stream.writeFrame(execFrame{Type: "error", Message: err.Error()})
		return
	}
	req := restClient.Post().
		Resource("pods").
		Namespace(namespace).
		Name(pod).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: query.Get("container"),
			Command:   command,
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(execConfig, http.MethodPost, req.URL())
	if err != nil {
		_ = stream.writeFrame(execFrame{Type: "error", Message: err.Error()})
		return
	}
	if err := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:             stream,
		Stdout:            stream.stdoutWriter(),
		Stderr:            stream.stderrWriter(),
		Tty:               true,
		TerminalSizeQueue: stream,
	}); err != nil && ctx.Err() == nil {
		_ = stream.writeFrame(execFrame{Type: "error", Message: err.Error()})
		return
	}
	_ = stream.writeFrame(execFrame{Type: "end"})
}

func (s *Server) handlePodAttachWS(w http.ResponseWriter, r *http.Request, id string) {
	cfg, err := s.registry.RESTConfig(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	query := r.URL.Query()
	namespace := strings.TrimSpace(query.Get("ns"))
	pod := strings.TrimSpace(query.Get("pod"))
	if namespace == "" || pod == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("ns and pod query parameters are required"))
		return
	}
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stream := newExecWebSocketStream(conn, cancel)
	go stream.readLoop()

	attachConfig := rest.CopyConfig(cfg)
	attachConfig.APIPath = "/api"
	attachConfig.GroupVersion = &corev1.SchemeGroupVersion
	attachConfig.NegotiatedSerializer = scheme.Codecs.WithoutConversion()

	restClient, err := rest.RESTClientFor(attachConfig)
	if err != nil {
		_ = stream.writeFrame(execFrame{Type: "error", Message: err.Error()})
		return
	}
	req := restClient.Post().
		Resource("pods").
		Namespace(namespace).
		Name(pod).
		SubResource("attach").
		VersionedParams(&corev1.PodAttachOptions{
			Container: query.Get("container"),
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(attachConfig, http.MethodPost, req.URL())
	if err != nil {
		_ = stream.writeFrame(execFrame{Type: "error", Message: err.Error()})
		return
	}
	if err := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:             stream,
		Stdout:            stream.stdoutWriter(),
		Stderr:            stream.stderrWriter(),
		Tty:               true,
		TerminalSizeQueue: stream,
	}); err != nil && ctx.Err() == nil {
		_ = stream.writeFrame(execFrame{Type: "error", Message: err.Error()})
		return
	}
	_ = stream.writeFrame(execFrame{Type: "end"})
}

func splitCommand(values []string) []string {
	var out []string
	for _, value := range values {
		for _, part := range strings.Split(value, "\x00") {
			part = strings.TrimSpace(part)
			if part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}

type execWebSocketStream struct {
	conn    *websocket.Conn
	cancel  context.CancelFunc
	stdin   chan []byte
	resize  chan remotecommand.TerminalSize
	pending []byte
	writeMu sync.Mutex
}

func newExecWebSocketStream(conn *websocket.Conn, cancel context.CancelFunc) *execWebSocketStream {
	return &execWebSocketStream{
		conn:   conn,
		cancel: cancel,
		stdin:  make(chan []byte, 64),
		resize: make(chan remotecommand.TerminalSize, 16),
	}
}

func (s *execWebSocketStream) readLoop() {
	defer s.cancel()
	defer close(s.stdin)
	defer close(s.resize)
	for {
		messageType, payload, err := s.conn.ReadMessage()
		if err != nil {
			return
		}
		if messageType == websocket.TextMessage {
			var frame execControlFrame
			if err := json.Unmarshal(payload, &frame); err == nil && frame.Type == "resize" && frame.Cols > 0 && frame.Rows > 0 {
				select {
				case s.resize <- remotecommand.TerminalSize{Width: frame.Cols, Height: frame.Rows}:
				default:
				}
				continue
			}
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}
		if len(payload) == 0 {
			continue
		}
		next := append([]byte(nil), payload...)
		s.stdin <- next
	}
}

func (s *execWebSocketStream) Read(p []byte) (int, error) {
	for len(s.pending) == 0 {
		next, ok := <-s.stdin
		if !ok {
			return 0, io.EOF
		}
		s.pending = next
	}
	n := copy(p, s.pending)
	s.pending = s.pending[n:]
	return n, nil
}

func (s *execWebSocketStream) Next() *remotecommand.TerminalSize {
	size, ok := <-s.resize
	if !ok {
		return nil
	}
	return &size
}

func (s *execWebSocketStream) stdoutWriter() io.Writer {
	return execFrameWriter{stream: s, frameType: "stdout"}
}

func (s *execWebSocketStream) stderrWriter() io.Writer {
	return execFrameWriter{stream: s, frameType: "stderr"}
}

func (s *execWebSocketStream) writeFrame(frame execFrame) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.conn.WriteJSON(frame)
}

type execFrameWriter struct {
	stream    *execWebSocketStream
	frameType string
}

func (w execFrameWriter) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if err := w.stream.writeFrame(execFrame{Type: w.frameType, Message: string(p)}); err != nil {
		return 0, err
	}
	return len(p), nil
}

type watchFrame struct {
	Type    string `json:"type"`
	Object  any    `json:"object,omitempty"`
	Message string `json:"message,omitempty"`
}

func (s *Server) handleWatchWS(w http.ResponseWriter, r *http.Request, id string) {
	def, err := resourceDefinitionFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	namespaces := splitQueryList(r.URL.Query()["namespace"])
	if !def.Namespaced {
		namespaces = []string{""}
	} else if len(namespaces) == 0 {
		namespaces = []string{""}
	}

	var writeMu sync.Mutex
	var wg sync.WaitGroup
	for _, namespace := range namespaces {
		namespace := namespace
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.watchResource(ctx, client, def, namespace, conn, &writeMu); err != nil && ctx.Err() == nil {
				writeMu.Lock()
				_ = conn.WriteJSON(watchFrame{Type: "ERROR", Message: err.Error()})
				writeMu.Unlock()
				cancel()
			}
		}()
	}
	wg.Wait()
}

func (s *Server) watchResource(ctx context.Context, client dynamic.Interface, def resourceDefinition, namespace string, conn *websocket.Conn, writeMu *sync.Mutex) error {
	resourceClient := resourceClientFor(client, def, namespace)
	resourceVersion := ""
	for {
		if err := ctx.Err(); err != nil {
			return nil
		}
		timeout := int64(300)
		watcher, err := resourceClient.Watch(ctx, metav1.ListOptions{
			AllowWatchBookmarks: true,
			ResourceVersion:     resourceVersion,
			TimeoutSeconds:      &timeout,
		})
		if err != nil {
			if apierrors.IsResourceExpired(err) || apierrors.IsGone(err) {
				nextResourceVersion, resetErr := resetWatchResourceVersion(ctx, resourceClient)
				if resetErr != nil {
					return resetErr
				}
				resourceVersion = nextResourceVersion
				if err := writeWatchFrame(conn, writeMu, watchFrame{Type: "RESET"}); err != nil {
					return err
				}
				continue
			}
			return err
		}
		for event := range watcher.ResultChan() {
			if event.Type == watch.Error {
				watcher.Stop()
				statusErr := apierrors.FromObject(event.Object)
				if apierrors.IsResourceExpired(statusErr) || apierrors.IsGone(statusErr) {
					nextResourceVersion, resetErr := resetWatchResourceVersion(ctx, resourceClient)
					if resetErr != nil {
						return resetErr
					}
					resourceVersion = nextResourceVersion
					if err := writeWatchFrame(conn, writeMu, watchFrame{Type: "RESET"}); err != nil {
						return err
					}
					break
				}
				return statusErr
			}

			frame := watchFrame{Type: string(event.Type)}
			object, nextResourceVersion := watchObjectPayload(event.Object, def.GVR)
			if nextResourceVersion != "" {
				resourceVersion = nextResourceVersion
			}
			frame.Object = object
			if err := writeWatchFrame(conn, writeMu, frame); err != nil {
				return err
			}
		}
		watcher.Stop()
	}
}

func resetWatchResourceVersion(ctx context.Context, resourceClient dynamic.ResourceInterface) (string, error) {
	list, err := resourceClient.List(ctx, metav1.ListOptions{})
	if err != nil {
		return "", err
	}
	return list.GetResourceVersion(), nil
}

func watchObjectPayload(object any, gvr schema.GroupVersionResource) (any, string) {
	switch typed := object.(type) {
	case *unstructured.Unstructured:
		if isSecretResource("", gvr) {
			maskSecret(typed)
		}
		return typed.Object, typed.GetResourceVersion()
	default:
		return object, ""
	}
}

func writeWatchFrame(conn *websocket.Conn, writeMu *sync.Mutex, frame watchFrame) error {
	writeMu.Lock()
	defer writeMu.Unlock()
	return conn.WriteJSON(frame)
}

func (s *Server) handleKubernetesProxy(w http.ResponseWriter, r *http.Request, id string, suffix string) {
	cfg, err := s.registry.RESTConfig(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	target, err := url.Parse(cfg.Host)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	transport, err := rest.TransportFor(cfg)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if suffix == "" {
		suffix = "/"
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = transport
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		writeError(w, http.StatusBadGateway, err)
	}
	proxy.Director = func(req *http.Request) {
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.URL.Path = singleJoiningSlash(target.Path, suffix)
		req.URL.RawPath = ""
		req.URL.RawQuery = r.URL.RawQuery
		req.Host = target.Host
		if cfg.UserAgent != "" {
			req.Header.Set("User-Agent", cfg.UserAgent)
		}
	}
	proxy.ServeHTTP(w, r)
}

func singleJoiningSlash(left string, right string) string {
	leftSlash := strings.HasSuffix(left, "/")
	rightSlash := strings.HasPrefix(right, "/")
	switch {
	case leftSlash && rightSlash:
		return left + right[1:]
	case !leftSlash && !rightSlash:
		return left + "/" + right
	default:
		return left + right
	}
}

func (s *Server) handleDiscovery(w http.ResponseWriter, r *http.Request, id string) {
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	lists, err := client.Discovery().ServerPreferredResources()
	if err != nil && len(lists) == 0 {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	type discoveryRow struct {
		GroupVersion string   `json:"groupVersion"`
		Group        string   `json:"group"`
		Version      string   `json:"version"`
		Resource     string   `json:"resource"`
		Kind         string   `json:"kind"`
		Namespaced   bool     `json:"namespaced"`
		Verbs        []string `json:"verbs"`
	}
	rows := []discoveryRow{}
	for _, list := range lists {
		gv, err := schema.ParseGroupVersion(list.GroupVersion)
		if err != nil {
			continue
		}
		for _, resource := range list.APIResources {
			if strings.Contains(resource.Name, "/") || !containsVerb(resource.Verbs, "list") || !containsVerb(resource.Verbs, "get") {
				continue
			}
			rows = append(rows, discoveryRow{
				GroupVersion: list.GroupVersion,
				Group:        gv.Group,
				Version:      gv.Version,
				Resource:     resource.Name,
				Kind:         resource.Kind,
				Namespaced:   resource.Namespaced,
				Verbs:        resource.Verbs,
			})
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].GroupVersion == rows[j].GroupVersion {
			return rows[i].Resource < rows[j].Resource
		}
		return rows[i].GroupVersion < rows[j].GroupVersion
	})
	writeJSON(w, http.StatusOK, rows)
}

type resourceDefinition struct {
	Label      string
	GVR        schema.GroupVersionResource
	Namespaced bool
}

func resourceClientFor(client dynamic.Interface, def resourceDefinition, namespace string) dynamic.ResourceInterface {
	if def.Namespaced && namespace != "" {
		return client.Resource(def.GVR).Namespace(namespace)
	}
	return client.Resource(def.GVR)
}

var resourceDefinitions = map[string]resourceDefinition{
	"pods":                            {Label: "Pods", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}, Namespaced: true},
	"deployments":                     {Label: "Deployments", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}, Namespaced: true},
	"statefulsets":                    {Label: "StatefulSets", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "statefulsets"}, Namespaced: true},
	"daemonsets":                      {Label: "DaemonSets", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "daemonsets"}, Namespaced: true},
	"replicasets":                     {Label: "ReplicaSets", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "replicasets"}, Namespaced: true},
	"controllerrevisions":             {Label: "ControllerRevisions", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "controllerrevisions"}, Namespaced: true},
	"jobs":                            {Label: "Jobs", GVR: schema.GroupVersionResource{Group: "batch", Version: "v1", Resource: "jobs"}, Namespaced: true},
	"cronjobs":                        {Label: "CronJobs", GVR: schema.GroupVersionResource{Group: "batch", Version: "v1", Resource: "cronjobs"}, Namespaced: true},
	"services":                        {Label: "Services", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "services"}, Namespaced: true},
	"endpointslices":                  {Label: "EndpointSlices", GVR: schema.GroupVersionResource{Group: "discovery.k8s.io", Version: "v1", Resource: "endpointslices"}, Namespaced: true},
	"ingresses":                       {Label: "Ingresses", GVR: schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"}, Namespaced: true},
	"ingressclasses":                  {Label: "IngressClasses", GVR: schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "ingressclasses"}, Namespaced: false},
	"gateways":                        {Label: "Gateways", GVR: schema.GroupVersionResource{Group: "gateway.networking.k8s.io", Version: "v1", Resource: "gateways"}, Namespaced: true},
	"gatewayclasses":                  {Label: "GatewayClasses", GVR: schema.GroupVersionResource{Group: "gateway.networking.k8s.io", Version: "v1", Resource: "gatewayclasses"}, Namespaced: false},
	"httproutes":                      {Label: "HTTPRoutes", GVR: schema.GroupVersionResource{Group: "gateway.networking.k8s.io", Version: "v1", Resource: "httproutes"}, Namespaced: true},
	"grpcroutes":                      {Label: "GRPCRoutes", GVR: schema.GroupVersionResource{Group: "gateway.networking.k8s.io", Version: "v1", Resource: "grpcroutes"}, Namespaced: true},
	"referencegrants":                 {Label: "ReferenceGrants", GVR: schema.GroupVersionResource{Group: "gateway.networking.k8s.io", Version: "v1beta1", Resource: "referencegrants"}, Namespaced: true},
	"backendtlspolicies":              {Label: "BackendTLSPolicies", GVR: schema.GroupVersionResource{Group: "gateway.networking.k8s.io", Version: "v1alpha3", Resource: "backendtlspolicies"}, Namespaced: true},
	"xbackendtrafficpolicies":         {Label: "XBackendTrafficPolicies", GVR: schema.GroupVersionResource{Group: "gateway.networking.x-k8s.io", Version: "v1alpha1", Resource: "xbackendtrafficpolicies"}, Namespaced: true},
	"networkpolicies":                 {Label: "NetworkPolicies", GVR: schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies"}, Namespaced: true},
	"horizontalpodautoscalers":        {Label: "HorizontalPodAutoscalers", GVR: schema.GroupVersionResource{Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers"}, Namespaced: true},
	"persistentvolumes":               {Label: "PersistentVolumes", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "persistentvolumes"}, Namespaced: false},
	"persistentvolumeclaims":          {Label: "PersistentVolumeClaims", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "persistentvolumeclaims"}, Namespaced: true},
	"storageclasses":                  {Label: "StorageClasses", GVR: schema.GroupVersionResource{Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses"}, Namespaced: false},
	"configmaps":                      {Label: "ConfigMaps", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "configmaps"}, Namespaced: true},
	"secrets":                         {Label: "Secrets", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "secrets"}, Namespaced: true},
	"serviceaccounts":                 {Label: "ServiceAccounts", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "serviceaccounts"}, Namespaced: true},
	"leases":                          {Label: "Leases", GVR: schema.GroupVersionResource{Group: "coordination.k8s.io", Version: "v1", Resource: "leases"}, Namespaced: true},
	"resourcequotas":                  {Label: "ResourceQuotas", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "resourcequotas"}, Namespaced: true},
	"limitranges":                     {Label: "LimitRanges", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "limitranges"}, Namespaced: true},
	"roles":                           {Label: "Roles", GVR: schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles"}, Namespaced: true},
	"rolebindings":                    {Label: "RoleBindings", GVR: schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "rolebindings"}, Namespaced: true},
	"clusterroles":                    {Label: "ClusterRoles", GVR: schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterroles"}, Namespaced: false},
	"clusterrolebindings":             {Label: "ClusterRoleBindings", GVR: schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterrolebindings"}, Namespaced: false},
	"priorityclasses":                 {Label: "PriorityClasses", GVR: schema.GroupVersionResource{Group: "scheduling.k8s.io", Version: "v1", Resource: "priorityclasses"}, Namespaced: false},
	"runtimeclasses":                  {Label: "RuntimeClasses", GVR: schema.GroupVersionResource{Group: "node.k8s.io", Version: "v1", Resource: "runtimeclasses"}, Namespaced: false},
	"mutatingwebhookconfigurations":   {Label: "MutatingWebhookConfigurations", GVR: schema.GroupVersionResource{Group: "admissionregistration.k8s.io", Version: "v1", Resource: "mutatingwebhookconfigurations"}, Namespaced: false},
	"validatingwebhookconfigurations": {Label: "ValidatingWebhookConfigurations", GVR: schema.GroupVersionResource{Group: "admissionregistration.k8s.io", Version: "v1", Resource: "validatingwebhookconfigurations"}, Namespaced: false},
	"nodes":                           {Label: "Nodes", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "nodes"}, Namespaced: false},
	"namespaces":                      {Label: "Namespaces", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "namespaces"}, Namespaced: false},
	"events":                          {Label: "Events", GVR: schema.GroupVersionResource{Group: "events.k8s.io", Version: "v1", Resource: "events"}, Namespaced: true},
	"crds":                            {Label: "CustomResourceDefinitions", GVR: schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"}, Namespaced: false},
	"endpoints":                       {Label: "Endpoints", GVR: schema.GroupVersionResource{Group: "", Version: "v1", Resource: "endpoints"}, Namespaced: true},
	"poddisruptionbudgets":            {Label: "PodDisruptionBudgets", GVR: schema.GroupVersionResource{Group: "policy", Version: "v1", Resource: "poddisruptionbudgets"}, Namespaced: true},
	"verticalpodautoscalers":          {Label: "VerticalPodAutoscalers", GVR: schema.GroupVersionResource{Group: "autoscaling.k8s.io", Version: "v1", Resource: "verticalpodautoscalers"}, Namespaced: true},
	"jobsets":                         {Label: "JobSets", GVR: schema.GroupVersionResource{Group: "jobset.x-k8s.io", Version: "v1alpha2", Resource: "jobsets"}, Namespaced: true},
}

type resourceOwnerRef struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	UID        string `json:"uid,omitempty"`
	Controller bool   `json:"controller,omitempty"`
}

func (s *Server) handleResourceList(w http.ResponseWriter, r *http.Request, id string, resource string) {
	def, ok := resourceDefinitions[resource]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown resource %q", resource))
		return
	}
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	namespaces := splitQueryList(r.URL.Query()["namespace"])
	labelSelector := r.URL.Query().Get("labelSelector")
	fieldSelector := r.URL.Query().Get("fieldSelector")
	if !def.Namespaced {
		namespaces = []string{""}
	} else if len(namespaces) == 0 {
		namespaces = []string{""}
	}

	type resourceRow struct {
		Name            string             `json:"name"`
		Namespace       string             `json:"namespace,omitempty"`
		Kind            string             `json:"kind"`
		APIVersion      string             `json:"apiVersion"`
		Status          string             `json:"status,omitempty"`
		Age             string             `json:"age"`
		OwnerReferences []resourceOwnerRef `json:"ownerReferences,omitempty"`
	}
	rows := []resourceRow{}
	for _, namespace := range namespaces {
		resourceClient := resourceClientFor(client, def, namespace)
		list, err := resourceClient.List(ctx, metav1.ListOptions{LabelSelector: labelSelector, FieldSelector: fieldSelector})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		for _, item := range list.Items {
			rows = append(rows, resourceRow{
				Name:            item.GetName(),
				Namespace:       item.GetNamespace(),
				Kind:            item.GetKind(),
				APIVersion:      item.GetAPIVersion(),
				Status:          resourceStatus(item),
				Age:             time.Since(item.GetCreationTimestamp().Time).Round(time.Second).String(),
				OwnerReferences: resourceOwnerRefs(item.GetOwnerReferences()),
			})
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Namespace == rows[j].Namespace {
			return rows[i].Name < rows[j].Name
		}
		return rows[i].Namespace < rows[j].Namespace
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"resource":   resource,
		"label":      def.Label,
		"namespaced": def.Namespaced,
		"items":      rows,
	})
}

func (s *Server) handleGVRList(w http.ResponseWriter, r *http.Request, id string) {
	def, err := resourceDefinitionFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.handleDynamicResourceList(w, r, id, def, def.GVR.Resource)
}

func (s *Server) handleGVRDetail(w http.ResponseWriter, r *http.Request, id string, namespace string, name string) {
	def, err := resourceDefinitionFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.handleDynamicResourceDetail(w, r, id, def, namespace, name, "")
}

func (s *Server) handleGVRApply(w http.ResponseWriter, r *http.Request, id string, namespace string, name string) {
	def, err := resourceDefinitionFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.handleDynamicResourceApply(w, r, id, def, namespace, name, "")
}

func (s *Server) handleGVRDelete(w http.ResponseWriter, r *http.Request, id string, namespace string, name string) {
	def, err := resourceDefinitionFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.handleDynamicResourceDelete(w, r, id, def, namespace, name)
}

func (s *Server) handleGVRScale(w http.ResponseWriter, r *http.Request, id string, namespace string, name string) {
	def, err := resourceDefinitionFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.handleDynamicResourceScale(w, r, id, def, namespace, name)
}

func (s *Server) handleDynamicResourceList(w http.ResponseWriter, r *http.Request, id string, def resourceDefinition, resource string) {
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	namespaces := splitQueryList(r.URL.Query()["namespace"])
	if !def.Namespaced {
		namespaces = []string{""}
	} else if len(namespaces) == 0 {
		namespaces = []string{""}
	}

	type resourceRow struct {
		Name            string             `json:"name"`
		Namespace       string             `json:"namespace,omitempty"`
		Kind            string             `json:"kind"`
		APIVersion      string             `json:"apiVersion"`
		Status          string             `json:"status,omitempty"`
		Age             string             `json:"age"`
		OwnerReferences []resourceOwnerRef `json:"ownerReferences,omitempty"`
	}
	rows := []resourceRow{}
	for _, namespace := range namespaces {
		resourceClient := resourceClientFor(client, def, namespace)
		list, err := resourceClient.List(ctx, metav1.ListOptions{})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		for _, item := range list.Items {
			rows = append(rows, resourceRow{
				Name:            item.GetName(),
				Namespace:       item.GetNamespace(),
				Kind:            item.GetKind(),
				APIVersion:      item.GetAPIVersion(),
				Status:          resourceStatus(item),
				Age:             time.Since(item.GetCreationTimestamp().Time).Round(time.Second).String(),
				OwnerReferences: resourceOwnerRefs(item.GetOwnerReferences()),
			})
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Namespace == rows[j].Namespace {
			return rows[i].Name < rows[j].Name
		}
		return rows[i].Namespace < rows[j].Namespace
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"resource":   resource,
		"label":      def.Label,
		"namespaced": def.Namespaced,
		"items":      rows,
	})
}

func resourceOwnerRefs(refs []metav1.OwnerReference) []resourceOwnerRef {
	rows := make([]resourceOwnerRef, 0, len(refs))
	for _, ref := range refs {
		rows = append(rows, resourceOwnerRef{
			APIVersion: ref.APIVersion,
			Kind:       ref.Kind,
			Name:       ref.Name,
			UID:        string(ref.UID),
			Controller: ref.Controller != nil && *ref.Controller,
		})
	}
	return rows
}

func (s *Server) handleResourceDetail(w http.ResponseWriter, r *http.Request, id string, resource string, namespace string, name string) {
	def, ok := resourceDefinitions[resource]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown resource %q", resource))
		return
	}
	s.handleDynamicResourceDetail(w, r, id, def, namespace, name, resource)
}

func (s *Server) handleResourceApply(w http.ResponseWriter, r *http.Request, id string, resource string, namespace string, name string) {
	def, ok := resourceDefinitions[resource]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown resource %q", resource))
		return
	}
	s.handleDynamicResourceApply(w, r, id, def, namespace, name, resource)
}

func (s *Server) handleResourceDelete(w http.ResponseWriter, r *http.Request, id string, resource string, namespace string, name string) {
	def, ok := resourceDefinitions[resource]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown resource %q", resource))
		return
	}
	s.handleDynamicResourceDelete(w, r, id, def, namespace, name)
}

func (s *Server) handleResourceScale(w http.ResponseWriter, r *http.Request, id string, resource string, namespace string, name string) {
	def, ok := resourceDefinitions[resource]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown resource %q", resource))
		return
	}
	s.handleDynamicResourceScale(w, r, id, def, namespace, name)
}

func (s *Server) handleDynamicResourceDetail(w http.ResponseWriter, r *http.Request, id string, def resourceDefinition, namespace string, name string, resource string) {
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	resourceClient := resourceClientFor(client, def, namespace)
	item, err := resourceClient.Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if isSecretResource(resource, def.GVR) {
		maskSecret(item)
	}
	writeJSON(w, http.StatusOK, item.Object)
}

func (s *Server) handleDynamicResourceApply(w http.ResponseWriter, r *http.Request, id string, def resourceDefinition, namespace string, name string, resource string) {
	if isSecretResource(resource, def.GVR) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("secret editing is disabled because secret values are masked in this UI"))
		return
	}
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	authzNamespace := namespace
	if !def.Namespaced || authzNamespace == "_" {
		authzNamespace = ""
	}
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Namespace: authzNamespace,
		Verb:      "patch",
		Group:     def.GVR.Group,
		Resource:  def.GVR.Resource,
		Name:      name,
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	authzCancel()
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	jsonBody, err := yaml.YAMLToJSON(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	var object unstructured.Unstructured
	if err := json.Unmarshal(jsonBody, &object.Object); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if object.GetName() != name {
		writeError(w, http.StatusBadRequest, fmt.Errorf("metadata.name must remain %q", name))
		return
	}
	if def.Namespaced {
		if namespace == "_" || namespace == "" {
			writeError(w, http.StatusBadRequest, fmt.Errorf("metadata.namespace is required for namespaced resources"))
			return
		}
		if object.GetNamespace() != namespace {
			writeError(w, http.StatusBadRequest, fmt.Errorf("metadata.namespace must remain %q", namespace))
			return
		}
	} else if object.GetNamespace() != "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("metadata.namespace must be empty for cluster-scoped resources"))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	resourceClient := resourceClientFor(client, def, namespace)
	options := applyPatchOptions(r)
	if r.URL.Query().Get("dryRun") == "true" {
		options.DryRun = []string{metav1.DryRunAll}
	}
	item, err := resourceClient.Patch(ctx, name, types.ApplyPatchType, jsonBody, options)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, item.Object)
}

func (s *Server) handleApply(w http.ResponseWriter, r *http.Request, id string) {
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	mapper, err := s.restMapperFor(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}

	raw, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	objects, err := decodeApplyObjects(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(objects) == 0 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("at least one YAML document is required"))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	options := applyPatchOptions(r)
	dryRun := r.URL.Query().Get("dryRun") == "true"
	if dryRun {
		options.DryRun = []string{metav1.DryRunAll}
	}

	type applyResult struct {
		APIGroup   string `json:"apiGroup"`
		APIVersion string `json:"apiVersion"`
		Kind       string `json:"kind"`
		Resource   string `json:"resource"`
		Namespace  string `json:"namespace,omitempty"`
		Name       string `json:"name"`
		DryRun     bool   `json:"dryRun"`
	}
	results := []applyResult{}
	for index, object := range objects {
		gvk := object.GroupVersionKind()
		if gvk.Empty() || gvk.Kind == "" || gvk.Version == "" {
			writeError(w, http.StatusBadRequest, fmt.Errorf("document %d must include apiVersion and kind", index+1))
			return
		}
		if object.GetName() == "" {
			writeError(w, http.StatusBadRequest, fmt.Errorf("document %d must include metadata.name", index+1))
			return
		}
		mapping, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("document %d %s: %w", index+1, gvk.String(), err))
			return
		}
		namespace := object.GetNamespace()
		var resourceClient dynamic.ResourceInterface
		if mapping.Scope.Name() == meta.RESTScopeNameNamespace {
			if namespace == "" {
				writeError(w, http.StatusBadRequest, fmt.Errorf("document %d %s/%s requires metadata.namespace", index+1, gvk.Kind, object.GetName()))
				return
			}
			resourceClient = client.Resource(mapping.Resource).Namespace(namespace)
		} else {
			object.SetNamespace("")
			resourceClient = client.Resource(mapping.Resource)
		}
		if err := s.authorize(ctx, id, authorizationv1.ResourceAttributes{
			Namespace: object.GetNamespace(),
			Verb:      "patch",
			Group:     mapping.Resource.Group,
			Resource:  mapping.Resource.Resource,
			Name:      object.GetName(),
		}); err != nil {
			writeError(w, http.StatusBadGateway, fmt.Errorf("document %d %s/%s: %w", index+1, gvk.Kind, object.GetName(), err))
			return
		}
		jsonBody, err := json.Marshal(object.Object)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		item, err := resourceClient.Patch(ctx, object.GetName(), types.ApplyPatchType, jsonBody, options)
		if err != nil {
			writeError(w, http.StatusBadGateway, fmt.Errorf("document %d %s/%s: %w", index+1, gvk.Kind, object.GetName(), err))
			return
		}
		results = append(results, applyResult{
			APIGroup:   mapping.Resource.Group,
			APIVersion: item.GetAPIVersion(),
			Kind:       item.GetKind(),
			Resource:   mapping.Resource.Resource,
			Namespace:  item.GetNamespace(),
			Name:       item.GetName(),
			DryRun:     dryRun,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"dryRun": dryRun, "items": results})
}

func applyPatchOptions(r *http.Request) metav1.PatchOptions {
	options := metav1.PatchOptions{FieldManager: "astronomer-lite"}
	if r.URL.Query().Get("force") == "true" {
		force := true
		options.Force = &force
	}
	return options
}

func (s *Server) handleDynamicResourceDelete(w http.ResponseWriter, r *http.Request, id string, def resourceDefinition, namespace string, name string) {
	if def.Namespaced && (namespace == "_" || namespace == "") {
		writeError(w, http.StatusBadRequest, fmt.Errorf("namespace is required for namespaced resources"))
		return
	}
	authzNamespace := namespace
	if !def.Namespaced {
		authzNamespace = ""
	}
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Namespace: authzNamespace,
		Verb:      "delete",
		Group:     def.GVR.Group,
		Resource:  def.GVR.Resource,
		Name:      name,
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	authzCancel()
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	resourceClient := resourceClientFor(client, def, namespace)
	if err := resourceClient.Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDynamicResourceScale(w http.ResponseWriter, r *http.Request, id string, def resourceDefinition, namespace string, name string) {
	if !supportsScale(def.GVR) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("%s/%s does not support scale actions", def.GVR.GroupVersion().String(), def.GVR.Resource))
		return
	}
	if namespace == "_" || namespace == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("namespace is required for scale actions"))
		return
	}
	var body struct {
		Replicas *int32 `json:"replicas"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.Replicas == nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("replicas is required"))
		return
	}
	if *body.Replicas < 0 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("replicas must be greater than or equal to 0"))
		return
	}
	authzCtx, authzCancel := context.WithTimeout(r.Context(), 10*time.Second)
	if err := s.authorize(authzCtx, id, authorizationv1.ResourceAttributes{
		Namespace:   namespace,
		Verb:        "patch",
		Group:       def.GVR.Group,
		Resource:    def.GVR.Resource,
		Subresource: "scale",
		Name:        name,
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	authzCancel()
	client, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	scale := autoscalingv1.Scale{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace},
		Spec:       autoscalingv1.ScaleSpec{Replicas: *body.Replicas},
	}
	raw, err := json.Marshal(scale)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	item, err := client.Resource(def.GVR).Namespace(namespace).Patch(ctx, name, types.MergePatchType, raw, metav1.PatchOptions{}, "scale")
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, item.Object)
}

func (s *Server) handleResourceRollback(w http.ResponseWriter, r *http.Request, id string, resource string, namespace string, name string) {
	if namespace == "_" || namespace == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("namespace is required for rollback"))
		return
	}
	if resource != "deployments" && resource != "statefulsets" && resource != "daemonsets" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("rollback is supported only for deployments, statefulsets, and daemonsets"))
		return
	}
	var body struct {
		Revision int64 `json:"revision"`
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
		Group:     "apps",
		Resource:  resource,
		Name:      name,
	}); err != nil {
		authzCancel()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	authzCancel()
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	switch resource {
	case "deployments":
		s.rollbackDeployment(ctx, w, client, namespace, name, body.Revision)
	case "statefulsets":
		s.rollbackStatefulSet(ctx, w, client, namespace, name, body.Revision)
	case "daemonsets":
		s.rollbackDaemonSet(ctx, w, client, namespace, name, body.Revision)
	}
}

func (s *Server) rollbackDeployment(ctx context.Context, w http.ResponseWriter, client *kubernetes.Clientset, namespace, name string, revision int64) {
	dep, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	rsList, err := client.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	var target *appsv1.ReplicaSet
	for i := range rsList.Items {
		rs := &rsList.Items[i]
		if !isOwnedBy(rs.OwnerReferences, dep.UID) {
			continue
		}
		if rs.Annotations["deployment.kubernetes.io/revision"] == strconv.FormatInt(revision, 10) {
			target = rs
			break
		}
	}
	if target == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("no ReplicaSet found for revision %d", revision))
		return
	}
	patch := map[string]any{
		"spec": map[string]any{
			"template": target.Spec.Template,
		},
		"metadata": map[string]any{
			"annotations": map[string]string{
				"kubernetes.io/change-cause": fmt.Sprintf("rollback to revision %d", revision),
			},
		},
	}
	raw, err := json.Marshal(patch)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	updated, err := client.AppsV1().Deployments(namespace).Patch(ctx, name, types.StrategicMergePatchType, raw, metav1.PatchOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revision": revision, "name": updated.Name})
}

func (s *Server) rollbackStatefulSet(ctx context.Context, w http.ResponseWriter, client *kubernetes.Clientset, namespace, name string, revision int64) {
	ss, err := client.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	target, err := findControllerRevision(ctx, client, namespace, ss.UID, revision)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if target == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("no ControllerRevision found for revision %d", revision))
		return
	}
	patched, err := client.AppsV1().StatefulSets(namespace).Patch(ctx, name, types.StrategicMergePatchType, target.Data.Raw, metav1.PatchOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revision": revision, "name": patched.Name})
}

func (s *Server) rollbackDaemonSet(ctx context.Context, w http.ResponseWriter, client *kubernetes.Clientset, namespace, name string, revision int64) {
	ds, err := client.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	target, err := findControllerRevision(ctx, client, namespace, ds.UID, revision)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if target == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("no ControllerRevision found for revision %d", revision))
		return
	}
	patched, err := client.AppsV1().DaemonSets(namespace).Patch(ctx, name, types.StrategicMergePatchType, target.Data.Raw, metav1.PatchOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revision": revision, "name": patched.Name})
}

func findControllerRevision(ctx context.Context, client *kubernetes.Clientset, namespace string, ownerUID types.UID, revision int64) (*appsv1.ControllerRevision, error) {
	list, err := client.AppsV1().ControllerRevisions(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for i := range list.Items {
		cr := &list.Items[i]
		if !isOwnedBy(cr.OwnerReferences, ownerUID) {
			continue
		}
		if cr.Revision == revision {
			return cr, nil
		}
	}
	return nil, nil
}

func isOwnedBy(refs []metav1.OwnerReference, uid types.UID) bool {
	for _, ref := range refs {
		if ref.UID == uid {
			return true
		}
	}
	return false
}

func isSecretResource(resource string, gvr schema.GroupVersionResource) bool {
	return resource == "secrets" || (gvr.Group == "" && gvr.Version == "v1" && gvr.Resource == "secrets")
}

func supportsScale(gvr schema.GroupVersionResource) bool {
	return gvr.Group == "apps" && gvr.Version == "v1" && (gvr.Resource == "deployments" || gvr.Resource == "statefulsets" || gvr.Resource == "replicasets")
}

func decodeApplyObjects(raw []byte) ([]unstructured.Unstructured, error) {
	decoder := k8syaml.NewYAMLOrJSONDecoder(bytes.NewReader(raw), 4096)
	objects := []unstructured.Unstructured{}
	for {
		var object unstructured.Unstructured
		if err := decoder.Decode(&object); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, err
		}
		if len(object.Object) == 0 {
			continue
		}
		objects = append(objects, object)
	}
	return objects, nil
}

func resourceDefinitionFromQuery(r *http.Request) (resourceDefinition, error) {
	query := r.URL.Query()
	resource := strings.TrimSpace(query.Get("resource"))
	version := strings.TrimSpace(query.Get("version"))
	if resource == "" || version == "" {
		return resourceDefinition{}, fmt.Errorf("resource and version query parameters are required")
	}
	group := strings.TrimSpace(query.Get("group"))
	namespaced := query.Get("namespaced") == "true"
	label := strings.TrimSpace(query.Get("kind"))
	if label == "" {
		label = resource
	}
	return resourceDefinition{
		Label:      label,
		GVR:        schema.GroupVersionResource{Group: group, Version: version, Resource: resource},
		Namespaced: namespaced,
	}, nil
}

func containsVerb(verbs []string, wanted string) bool {
	for _, verb := range verbs {
		if verb == wanted {
			return true
		}
	}
	return false
}

func resourceStatus(item unstructured.Unstructured) string {
	if phase, ok, _ := unstructured.NestedString(item.Object, "status", "phase"); ok && phase != "" {
		return phase
	}
	if replicas, ok, _ := unstructured.NestedInt64(item.Object, "status", "readyReplicas"); ok {
		desired, _, _ := unstructured.NestedInt64(item.Object, "spec", "replicas")
		if desired > 0 {
			return fmt.Sprintf("%d/%d ready", replicas, desired)
		}
		return fmt.Sprintf("%d ready", replicas)
	}
	if available, ok, _ := unstructured.NestedInt64(item.Object, "status", "availableReplicas"); ok {
		desired, _, _ := unstructured.NestedInt64(item.Object, "status", "replicas")
		if desired > 0 {
			return fmt.Sprintf("%d/%d available", available, desired)
		}
	}
	if typeValue, ok, _ := unstructured.NestedString(item.Object, "type"); ok && typeValue != "" {
		return typeValue
	}
	return ""
}

type eventRow struct {
	Name                string `json:"name"`
	Namespace           string `json:"namespace,omitempty"`
	Type                string `json:"type"`
	Reason              string `json:"reason"`
	Note                string `json:"note"`
	Action              string `json:"action"`
	RegardingKind       string `json:"regardingKind"`
	RegardingName       string `json:"regardingName"`
	RegardingNamespace  string `json:"regardingNamespace,omitempty"`
	ReportingController string `json:"reportingController"`
	Count               int64  `json:"count"`
	EventTime           string `json:"eventTime"`
	FirstTimestamp      string `json:"firstTimestamp"`
	LastTimestamp       string `json:"lastTimestamp"`
	Age                 string `json:"age"`
}

func eventRowFromObject(object map[string]any) eventRow {
	meta := recordFromMap(object, "metadata")
	regarding := recordFromMap(object, "regarding")
	series := recordFromMap(object, "series")
	eventTime := stringFromMap(object, "eventTime")
	firstTimestamp := stringFromMap(object, "deprecatedFirstTimestamp")
	lastTimestamp := stringFromMap(object, "deprecatedLastTimestamp")
	if seriesLastObserved := stringFromMap(series, "lastObservedTime"); seriesLastObserved != "" {
		lastTimestamp = seriesLastObserved
	}
	if lastTimestamp == "" {
		lastTimestamp = eventTime
	}
	if firstTimestamp == "" {
		firstTimestamp = eventTime
	}
	count := int64FromMap(object, "deprecatedCount")
	if seriesCount := int64FromMap(series, "count"); seriesCount > 0 {
		count = seriesCount
	}
	if count == 0 {
		count = 1
	}
	return eventRow{
		Name:                stringFromMap(meta, "name"),
		Namespace:           stringFromMap(meta, "namespace"),
		Type:                stringFromMap(object, "type"),
		Reason:              stringFromMap(object, "reason"),
		Note:                stringFromMap(object, "note"),
		Action:              stringFromMap(object, "action"),
		RegardingKind:       stringFromMap(regarding, "kind"),
		RegardingName:       stringFromMap(regarding, "name"),
		RegardingNamespace:  stringFromMap(regarding, "namespace"),
		ReportingController: stringFromMap(object, "reportingController"),
		Count:               count,
		EventTime:           eventTime,
		FirstTimestamp:      firstTimestamp,
		LastTimestamp:       lastTimestamp,
		Age:                 ageFromKubernetesTimestamp(lastTimestamp),
	}
}

func recordFromMap(object map[string]any, key string) map[string]any {
	value, ok := object[key]
	if !ok {
		return map[string]any{}
	}
	record, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return record
}

func stringFromMap(object map[string]any, key string) string {
	value, ok := object[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprint(value)
	}
}

func int64FromMap(object map[string]any, key string) int64 {
	value, ok := object[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return parsed
	default:
		return 0
	}
}

func ageFromKubernetesTimestamp(value string) string {
	if value == "" {
		return ""
	}
	timestamp, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return ""
	}
	return time.Since(timestamp).Round(time.Second).String()
}

type metricsRow struct {
	Name              string  `json:"name"`
	Namespace         string  `json:"namespace,omitempty"`
	CPU               int64   `json:"cpu"`
	Memory            int64   `json:"memory"`
	CPUPercent        float64 `json:"cpuPercent,omitempty"`
	MemoryPercent     float64 `json:"memoryPercent,omitempty"`
	CapacityCPU       int64   `json:"capacityCPU,omitempty"`
	CapacityMemory    int64   `json:"capacityMemory,omitempty"`
	Window            string  `json:"window,omitempty"`
	Timestamp         string  `json:"timestamp,omitempty"`
	ContainerCount    int64   `json:"containerCount,omitempty"`
	RegardingResource string  `json:"regardingResource"`
}

func metricQuantityMilli(object map[string]any, fields ...string) int64 {
	value, ok, _ := unstructured.NestedString(object, fields...)
	if !ok || value == "" {
		return 0
	}
	quantity, err := resource.ParseQuantity(value)
	if err != nil {
		return 0
	}
	return quantity.MilliValue()
}

func metricQuantityBytes(object map[string]any, fields ...string) int64 {
	value, ok, _ := unstructured.NestedString(object, fields...)
	if !ok || value == "" {
		return 0
	}
	quantity, err := resource.ParseQuantity(value)
	if err != nil {
		return 0
	}
	return quantity.Value()
}

func percent(value int64, capacity int64) float64 {
	if capacity <= 0 {
		return 0
	}
	return float64(value) / float64(capacity) * 100
}

func maskSecret(item *unstructured.Unstructured) {
	redactSecretMap(item.Object, "data")
	redactSecretMap(item.Object, "stringData")
}

func redactSecretMap(object map[string]any, field string) {
	value, ok := object[field]
	if !ok {
		return
	}
	switch typed := value.(type) {
	case map[string]string:
		for key := range typed {
			typed[key] = "********"
		}
		object[field] = typed
	case map[string]any:
		for key := range typed {
			typed[key] = "********"
		}
		object[field] = typed
	}
}

func splitQueryList(values []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, value := range values {
		for _, item := range strings.Split(value, ",") {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			if _, ok := seen[item]; ok {
				continue
			}
			seen[item] = struct{}{}
			out = append(out, item)
		}
	}
	sort.Strings(out)
	return out
}

func strconvPair(ready, total int) string {
	return fmt.Sprintf("%d/%d", ready, total)
}

func (s *Server) handlePluginNav(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, plugins.DefaultRegistry().NavItems())
}

func (s *Server) spaHandler() http.Handler {
	dist, err := fs.Sub(embeddedDist, "static/dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, os.ErrNotExist)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" {
			if file, err := dist.Open(path); err == nil {
				_ = file.Close()
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// errForbidden is returned by (*Server).authorize when a SelfSubjectAccessReview
// reports the caller is not allowed to perform the requested action. writeError
// maps it to HTTP 403 so the server-side double-check produces a clean error
// path independent of the eventual K8s 403 propagated as 502 BadGateway.
var errForbidden = errors.New("forbidden by Kubernetes RBAC")

func writeError(w http.ResponseWriter, status int, err error) {
	if errors.Is(err, errForbidden) {
		status = http.StatusForbidden
	} else if errors.Is(err, os.ErrNotExist) {
		status = http.StatusNotFound
	} else if apiStatus, ok := err.(apierrors.APIStatus); ok {
		if code := int(apiStatus.Status().Code); code > 0 {
			status = code
		}
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

// selfSubjectAccessReview is the shared SSAR primitive used by both the
// /can-i endpoint and the server-side authorize() guard.
func (s *Server) selfSubjectAccessReview(ctx context.Context, id string, attrs authorizationv1.ResourceAttributes) (authorizationv1.SubjectAccessReviewStatus, error) {
	client, err := s.registry.Client(id)
	if err != nil {
		return authorizationv1.SubjectAccessReviewStatus{}, err
	}
	review, err := client.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, &authorizationv1.SelfSubjectAccessReview{
		Spec: authorizationv1.SelfSubjectAccessReviewSpec{ResourceAttributes: &attrs},
	}, metav1.CreateOptions{})
	if err != nil {
		return authorizationv1.SubjectAccessReviewStatus{}, err
	}
	return review.Status, nil
}

// authorize returns errForbidden when the SSAR for attrs is not allowed.
// Failures to reach the authorization API are returned as wrapped errors
// (callers propagate via writeError -> 502 BadGateway).
func (s *Server) authorize(ctx context.Context, id string, attrs authorizationv1.ResourceAttributes) error {
	status, err := s.selfSubjectAccessReview(ctx, id, attrs)
	if err != nil {
		return fmt.Errorf("authorize %s %s/%s: %w", attrs.Verb, attrs.Group, attrs.Resource, err)
	}
	if status.Allowed && !status.Denied {
		return nil
	}
	reason := strings.TrimSpace(status.Reason)
	if reason == "" {
		reason = status.EvaluationError
	}
	if reason != "" {
		return fmt.Errorf("%w: %s %s/%s in %q: %s", errForbidden, attrs.Verb, attrs.Group, attrs.Resource, attrs.Namespace, reason)
	}
	return fmt.Errorf("%w: %s %s/%s in %q", errForbidden, attrs.Verb, attrs.Group, attrs.Resource, attrs.Namespace)
}

func logRequests(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		logger.Info("request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(start))
	})
}
