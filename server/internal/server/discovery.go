package server

import (
	"net/http"
	"sort"
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

func (s *Server) handleDiscovery(w http.ResponseWriter, r *http.Request, id string) {
	client, err := s.kubeClientFor(id)
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
