package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/auth"
	authorizationv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
)

func (s *Server) handleExtensions(w http.ResponseWriter, r *http.Request) {
	if !s.Config.PluginsEnabled || s.extensions == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("plugins are disabled"))
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/extensions"), "/"), "/")
	if parts[0] == "_catalog" || parts[0] == "_install" {
		if s.Config.AuthMode == "server" && auth.CurrentUser(r.Context()).Role != "admin" {
			writeError(w, 403, fmt.Errorf("administrator required"))
			return
		}
		if parts[0] == "_catalog" && r.Method == http.MethodGet {
			if !s.extensions.DistributionEnabled() {
				writeJSON(w, 200, map[string]any{"configured": false, "packages": []any{}})
				return
			}
			index, err := s.extensions.Available(r.Context())
			if err != nil {
				writeError(w, 502, err)
				return
			}
			writeJSON(w, 200, map[string]any{"configured": true, "packages": index.Packages})
			return
		}
		if parts[0] == "_install" && r.Method == http.MethodPost {
			var body struct {
				ID      string `json:"id"`
				Version string `json:"version"`
				Digest  string `json:"digest"`
			}
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body) != nil {
				writeError(w, 400, fmt.Errorf("invalid install request"))
				return
			}
			if err := s.extensions.Install(r.Context(), body.ID, body.Version, body.Digest); err != nil {
				writeError(w, 409, err)
				return
			}
			s.logger.Info("plugin installed", "plugin", body.ID, "version", body.Version, "actor", auth.CurrentUser(r.Context()).ID)
			w.WriteHeader(204)
			return
		}
		writeError(w, 405, fmt.Errorf("method not allowed"))
		return
	}
	if parts[0] == "" && r.Method == "GET" {
		writeJSON(w, 200, s.extensions.List())
		return
	}
	extension, ok := s.extensions.Get(parts[0])
	if !ok {
		writeError(w, 404, fmt.Errorf("plugin not found"))
		return
	}
	if len(parts) == 1 && r.Method == "PATCH" {
		if s.Config.AuthMode == "server" && auth.CurrentUser(r.Context()).Role != "admin" {
			writeError(w, 403, fmt.Errorf("administrator required"))
			return
		}
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil {
			writeError(w, 400, err)
			return
		}
		if err := s.extensions.SetEnabled(extension.ID, body.Enabled); err != nil {
			writeError(w, 500, err)
			return
		}
		s.logger.Info("plugin status changed", "plugin", extension.ID, "enabled", body.Enabled, "actor", auth.CurrentUser(r.Context()).ID)
		w.WriteHeader(204)
		return
	}
	if !extension.Enabled {
		writeError(w, 403, fmt.Errorf("plugin is disabled"))
		return
	}
	if len(parts) == 2 && parts[1] == "bundle" && r.Method == "GET" {
		writeJSON(w, 200, map[string]string{"html": extension.HTML})
		return
	}
	if len(parts) == 2 && parts[1] == "settings" {
		w.Header().Set("Cache-Control", "no-store")
		path := filepath.Join(s.Config.ConfigDir, "plugin-settings", extension.ID+".json")
		if r.Method == http.MethodGet {
			data, err := os.ReadFile(path)
			if os.IsNotExist(err) {
				writeJSON(w, 200, map[string]any{})
				return
			}
			if err != nil {
				writeError(w, 500, fmt.Errorf("could not load plugin settings"))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(data)
			return
		}
		if r.Method == http.MethodPut {
			var value map[string]json.RawMessage
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&value); err != nil || value == nil {
				writeError(w, 400, fmt.Errorf("plugin settings must be a JSON object smaller than 32 KiB"))
				return
			}
			data, _ := json.Marshal(value)
			if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
				writeError(w, 500, err)
				return
			}
			f, err := os.CreateTemp(filepath.Dir(path), ".settings-*")
			if err != nil {
				writeError(w, 500, err)
				return
			}
			defer func() { _ = os.Remove(f.Name()) }()
			_, err = f.Write(data)
			if err == nil {
				err = f.Sync()
			}
			closeErr := f.Close()
			if err == nil {
				err = closeErr
			}
			if err == nil {
				err = os.Rename(f.Name(), path)
			}
			if err != nil {
				writeError(w, 500, fmt.Errorf("could not save plugin settings"))
				return
			}
			w.WriteHeader(204)
			return
		}
		writeError(w, 405, fmt.Errorf("method not allowed"))
		return
	}
	if len(parts) != 2 || parts[1] != "resources" || r.Method != "POST" {
		writeError(w, 405, fmt.Errorf("method not allowed"))
		return
	}
	var body struct {
		ClusterID string         `json:"clusterId"`
		Group     string         `json:"group"`
		Version   string         `json:"version"`
		Resource  string         `json:"resource"`
		Namespace string         `json:"namespace"`
		Name      string         `json:"name"`
		Verb      string         `json:"verb"`
		DryRun    bool           `json:"dryRun"`
		Continue  string         `json:"continue"`
		Object    map[string]any `json:"object"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&body); err != nil {
		writeError(w, 400, err)
		return
	}
	if !extension.Allows(body.Group, body.Resource, body.Verb) {
		writeError(w, 403, fmt.Errorf("plugin does not have permission to %s %s/%s", body.Verb, body.Group, body.Resource))
		return
	}
	if _, ok := s.registry.Get(body.ClusterID); !ok {
		writeError(w, 404, fmt.Errorf("cluster not found"))
		return
	}
	if body.Version == "" || strings.ContainsAny(body.Resource+body.Version+body.Namespace+body.Name, "/\\%") {
		writeError(w, 400, fmt.Errorf("invalid resource address"))
		return
	}
	mapper, err := s.restMapperFor(body.ClusterID)
	if err != nil {
		writeError(w, 502, err)
		return
	}
	gvr := schema.GroupVersionResource{Group: body.Group, Version: body.Version, Resource: body.Resource}
	gvk, err := mapper.KindFor(gvr)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	mapping, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	namespaced := mapping.Scope.Name() == meta.RESTScopeNameNamespace
	if (!namespaced && body.Namespace != "") || (namespaced && body.Namespace == "" && body.Verb != "list") || (body.Verb != "list" && body.Name == "") {
		writeError(w, 400, fmt.Errorf("resource name and namespace must match its scope"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	verb := body.Verb
	if verb == "apply" {
		verb = "patch"
	}
	if err = s.authorize(ctx, body.ClusterID, authorizationv1.ResourceAttributes{Group: body.Group, Resource: body.Resource, Verb: verb, Namespace: body.Namespace, Name: body.Name}); err != nil {
		writeError(w, 403, err)
		return
	}
	client, err := s.dynamicClientFor(body.ClusterID)
	if err != nil {
		writeError(w, 502, err)
		return
	}
	var resource dynamic.ResourceInterface = client.Resource(gvr)
	if namespaced {
		resource = client.Resource(gvr).Namespace(body.Namespace)
	}
	var result any
	dryRun := []string(nil)
	if body.DryRun {
		dryRun = []string{metav1.DryRunAll}
	}
	switch body.Verb {
	case "list":
		result, err = resource.List(ctx, metav1.ListOptions{Limit: 500, Continue: body.Continue})
	case "get":
		result, err = resource.Get(ctx, body.Name, metav1.GetOptions{})
	case "delete":
		err = resource.Delete(ctx, body.Name, metav1.DeleteOptions{DryRun: dryRun})
		result = map[string]bool{"deleted": err == nil, "dryRun": body.DryRun}
	case "apply":
		obj := &unstructured.Unstructured{Object: body.Object}
		if obj.GetName() != body.Name || obj.GetNamespace() != body.Namespace || obj.GetAPIVersion() != gvk.GroupVersion().String() || obj.GetKind() != gvk.Kind {
			writeError(w, 400, fmt.Errorf("manifest identity must match the permitted resource"))
			return
		}
		var raw []byte
		raw, err = json.Marshal(body.Object)
		if err == nil {
			result, err = resource.Patch(ctx, body.Name, types.ApplyPatchType, raw, metav1.PatchOptions{FieldManager: "astronomer-lite-plugin-" + extension.ID, DryRun: dryRun})
		}
	}
	if err != nil {
		writeError(w, 502, err)
		return
	}
	if body.Verb == "apply" || body.Verb == "delete" {
		s.logger.Info("plugin resource action", "plugin", extension.ID, "actor", auth.CurrentUser(r.Context()).ID, "cluster", body.ClusterID, "verb", body.Verb, "resource", body.Resource, "namespace", body.Namespace, "name", body.Name, "dryRun", body.DryRun)
	}
	writeJSON(w, 200, result)
}
