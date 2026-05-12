package server

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type searchHit struct {
	Kind       string `json:"kind"`
	APIVersion string `json:"apiVersion"`
	Resource   string `json:"resource"`
	Namespace  string `json:"namespace,omitempty"`
	Name       string `json:"name"`
}

// Default fan-out kinds when the caller does not constrain the search. Chosen
// to cover the workloads/discovery/config that users typically look for first.
var defaultSearchKinds = []schema.GroupVersionResource{
	{Group: "", Version: "v1", Resource: "pods"},
	{Group: "apps", Version: "v1", Resource: "deployments"},
	{Group: "apps", Version: "v1", Resource: "statefulsets"},
	{Group: "apps", Version: "v1", Resource: "daemonsets"},
	{Group: "", Version: "v1", Resource: "services"},
	{Group: "", Version: "v1", Resource: "configmaps"},
	{Group: "", Version: "v1", Resource: "secrets"},
	{Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"},
	{Group: "", Version: "v1", Resource: "namespaces"},
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request, id string) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeJSON(w, http.StatusOK, []searchHit{})
		return
	}
	dyn, err := s.registry.Dynamic(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	listOpts := metav1.ListOptions{Limit: 500}
	labelSelector := ""
	if eq := strings.Index(query, "="); eq > 0 && !strings.ContainsAny(query, " \t") {
		labelSelector = query
		listOpts.LabelSelector = labelSelector
	}
	matcher := strings.ToLower(query)

	results := make([]searchHit, 0, 32)
	var mu sync.Mutex
	var wg sync.WaitGroup
	const maxResults = 200

	for _, gvr := range defaultSearchKinds {
		gvr := gvr
		wg.Add(1)
		go func() {
			defer wg.Done()
			list, err := dyn.Resource(gvr).List(ctx, listOpts)
			if err != nil || list == nil {
				return
			}
			for _, item := range list.Items {
				name := item.GetName()
				if labelSelector == "" && !strings.Contains(strings.ToLower(name), matcher) {
					continue
				}
				mu.Lock()
				if len(results) >= maxResults {
					mu.Unlock()
					return
				}
				results = append(results, searchHit{
					Kind:       item.GetKind(),
					APIVersion: item.GetAPIVersion(),
					Resource:   gvr.Resource,
					Namespace:  item.GetNamespace(),
					Name:       name,
				})
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	sort.Slice(results, func(i, j int) bool {
		if results[i].Kind != results[j].Kind {
			return results[i].Kind < results[j].Kind
		}
		if results[i].Namespace != results[j].Namespace {
			return results[i].Namespace < results[j].Namespace
		}
		return results[i].Name < results[j].Name
	})

	writeJSON(w, http.StatusOK, results)
}
