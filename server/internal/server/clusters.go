package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/kubeconfig"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

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
	if len(parts) == 4 && parts[1] == "portforwards" && parts[3] == "browser" && r.Method == http.MethodGet {
		s.handlePortForwardBrowser(w, r, id, parts[2])
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
	client, err := s.kubeClientFor(id)
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
