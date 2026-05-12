package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/cache"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Prometheus auto-detect: scan a small set of well-known service names in
// common namespaces. Headlamp/Freelens do the same — kube-prometheus-stack
// publishes to `prometheus-operated`, the helm chart to `prometheus-server`,
// OpenShift to `prometheus-k8s`, etc. Detection runs lazily on first prom
// request per cluster and is cached for 10 minutes.

type promTarget struct {
	Namespace string `json:"namespace"`
	Service   string `json:"service"`
	Port      int    `json:"port"`
	Source    string `json:"source"`
}

type promDetectionResult struct {
	Available bool        `json:"available"`
	Target    *promTarget `json:"target,omitempty"`
	Reason    string      `json:"reason,omitempty"`
	CheckedAt string      `json:"checkedAt"`
}

const promCacheTTL = 10 * time.Minute

// promCache stores prometheus detection results keyed by cluster id. It is
// registered with the Registry invalidation hook in Server.New.
var promCache = cache.NewTTLCache[promDetectionResult](promCacheTTL)

type promCandidate struct {
	Namespace string
	Service   string
	Port      int
	Source    string
}

var promCandidates = []promCandidate{
	{Namespace: "monitoring", Service: "prometheus-operated", Port: 9090, Source: "kube-prometheus-stack"},
	{Namespace: "monitoring", Service: "prometheus-k8s", Port: 9090, Source: "kube-prometheus-stack"},
	{Namespace: "monitoring", Service: "prometheus-server", Port: 80, Source: "helm-prometheus"},
	{Namespace: "prometheus", Service: "prometheus-server", Port: 80, Source: "helm-prometheus"},
	{Namespace: "kube-prometheus-stack", Service: "prometheus-operated", Port: 9090, Source: "kube-prometheus-stack"},
	{Namespace: "openshift-monitoring", Service: "prometheus-k8s", Port: 9090, Source: "openshift-monitoring"},
	{Namespace: "kube-system", Service: "prometheus", Port: 9090, Source: "kube-system"},
}

// handleProm dispatches under /api/clusters/{id}/prom/...
//
//	GET /api/clusters/{id}/prom/detect
//	GET /api/clusters/{id}/prom/query_range?query=...&start=...&end=...&step=...
func (s *Server) handleProm(w http.ResponseWriter, r *http.Request, id string, parts []string) {
	switch {
	case len(parts) == 1 && parts[0] == "detect" && r.Method == http.MethodGet:
		s.promDetect(w, r, id, true)
		return
	case len(parts) == 1 && parts[0] == "query_range" && r.Method == http.MethodGet:
		s.promQueryRange(w, r, id)
		return
	}
	writeError(w, http.StatusNotFound, os.ErrNotExist)
}

func (s *Server) promDetect(w http.ResponseWriter, r *http.Request, id string, write bool) promDetectionResult {
	if cached, ok := promCache.Get(id); ok {
		if write {
			writeJSON(w, http.StatusOK, cached)
		}
		return cached
	}

	client, err := s.registry.Client(id)
	if err != nil {
		result := promDetectionResult{Available: false, Reason: err.Error(), CheckedAt: time.Now().UTC().Format(time.RFC3339)}
		if write {
			writeError(w, http.StatusBadGateway, err)
		}
		return result
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	var found *promTarget
	for _, candidate := range promCandidates {
		svc, err := client.CoreV1().Services(candidate.Namespace).Get(ctx, candidate.Service, metav1.GetOptions{})
		if err != nil || svc == nil {
			continue
		}
		port := candidate.Port
		for _, p := range svc.Spec.Ports {
			if p.Name == "web" || p.Name == "http-web" || p.Name == "http" {
				port = int(p.Port)
				break
			}
		}
		found = &promTarget{Namespace: candidate.Namespace, Service: candidate.Service, Port: port, Source: candidate.Source}
		break
	}

	result := promDetectionResult{Available: found != nil, Target: found, CheckedAt: time.Now().UTC().Format(time.RFC3339)}
	if found == nil {
		result.Reason = "no known Prometheus service found"
	}
	promCache.Put(id, result)
	if write {
		writeJSON(w, http.StatusOK, result)
	}
	return result
}

func (s *Server) promQueryRange(w http.ResponseWriter, r *http.Request, id string) {
	detection := s.promDetect(w, r, id, false)
	if !detection.Available || detection.Target == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("prometheus is not detected on this cluster"))
		return
	}
	target := detection.Target
	query := strings.TrimSpace(r.URL.Query().Get("query"))
	if query == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("query is required"))
		return
	}
	start := strings.TrimSpace(r.URL.Query().Get("start"))
	end := strings.TrimSpace(r.URL.Query().Get("end"))
	step := strings.TrimSpace(r.URL.Query().Get("step"))
	now := time.Now().UTC()
	if start == "" {
		start = now.Add(-1 * time.Hour).Format(time.RFC3339)
	}
	if end == "" {
		end = now.Format(time.RFC3339)
	}
	if step == "" {
		step = "30s"
	}
	client, err := s.registry.Client(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	// Proxy through the API server: /api/v1/namespaces/{ns}/services/{name}:{port}/proxy/api/v1/query_range
	path := fmt.Sprintf("/api/v1/namespaces/%s/services/%s:%d/proxy/api/v1/query_range", target.Namespace, target.Service, target.Port)
	values := url.Values{}
	values.Set("query", query)
	values.Set("start", start)
	values.Set("end", end)
	values.Set("step", step)
	req := client.CoreV1().RESTClient().Get().AbsPath(path).Param("query", query).Param("start", start).Param("end", end).Param("step", step)
	raw, err := req.Do(ctx).Raw()
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	// Promethees responds with {status:"success", data:{result:[...]}}; pass it
	// through verbatim.
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
}

// Ensure helpers stay imported even if a future refactor inlines them.
var _ = io.Copy
var _ = json.Marshal
