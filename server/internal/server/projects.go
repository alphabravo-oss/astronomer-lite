package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/util/validation"
)

type projectScope struct {
	ClusterID string `json:"clusterId"`
	Namespace string `json:"namespace"`
}
type project struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Scopes      []projectScope `json:"scopes"`
	Revision    int            `json:"revision"`
	UpdatedAt   string         `json:"updatedAt"`
}

func (s *Server) readProjects() ([]project, error) {
	data, err := os.ReadFile(filepath.Join(s.Config.ConfigDir, "projects.json"))
	if errors.Is(err, os.ErrNotExist) {
		return []project{}, nil
	}
	if err != nil {
		return nil, err
	}
	var projects []project
	if err := json.Unmarshal(data, &projects); err != nil {
		return nil, err
	}
	if projects == nil {
		projects = []project{}
	}
	return projects, nil
}

func atomicJSON(path string, value any) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".state-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(file.Name()) }()
	defer func() { _ = file.Close() }()
	if err = json.NewEncoder(file).Encode(value); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}

func (s *Server) validateProject(item *project) error {
	item.Name = strings.TrimSpace(item.Name)
	if item.Name == "" || len(item.Name) > 100 || len(item.Description) > 2000 {
		return fmt.Errorf("project name is required (up to 100 bytes); description is limited to 2000 bytes")
	}
	if len(item.Scopes) == 0 || len(item.Scopes) > 32 {
		return fmt.Errorf("choose between 1 and 32 cluster/namespace scopes")
	}
	seen := map[projectScope]bool{}
	for _, scope := range item.Scopes {
		if _, ok := s.registry.Get(scope.ClusterID); !ok {
			return fmt.Errorf("project references a cluster outside this workspace")
		}
		if len(validation.IsDNS1123Label(scope.Namespace)) != 0 {
			return fmt.Errorf("project scopes require a valid namespace")
		}
		if seen[scope] {
			return fmt.Errorf("duplicate cluster/namespace scope")
		}
		seen[scope] = true
	}
	return nil
}

func (s *Server) handleProjects(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/projects")
	if id != "" {
		if !strings.HasPrefix(id, "/") || strings.Contains(id[1:], "/") {
			writeError(w, 404, os.ErrNotExist)
			return
		}
		id = id[1:]
	}
	s.projectsMu.Lock()
	defer s.projectsMu.Unlock()
	items, err := s.readProjects()
	if err != nil {
		writeError(w, 500, fmt.Errorf("could not read projects"))
		return
	}
	index := -1
	for i := range items {
		if items[i].ID == id {
			index = i
			break
		}
	}
	if id != "" && index < 0 {
		writeError(w, 404, os.ErrNotExist)
		return
	}
	if r.Method == http.MethodGet {
		if id == "" {
			writeJSON(w, 200, items)
		} else {
			writeJSON(w, 200, items[index])
		}
		return
	}
	if r.Method == http.MethodDelete && id != "" {
		items = append(items[:index], items[index+1:]...)
		if err := atomicJSON(filepath.Join(s.Config.ConfigDir, "projects.json"), items); err != nil {
			writeError(w, 500, err)
			return
		}
		w.WriteHeader(204)
		return
	}
	if (r.Method != http.MethodPost || id != "") && (r.Method != http.MethodPut || id == "") {
		writeError(w, 405, fmt.Errorf("method not allowed"))
		return
	}
	var item project
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&item); err != nil {
		writeError(w, 400, err)
		return
	}
	if err := s.validateProject(&item); err != nil {
		writeError(w, 400, err)
		return
	}
	status := 200
	if id == "" {
		if len(items) >= 100 {
			writeError(w, 400, fmt.Errorf("workspace limit of 100 projects reached"))
			return
		}
		nonce := make([]byte, 16)
		if _, err := rand.Read(nonce); err != nil {
			writeError(w, 500, err)
			return
		}
		item.ID, item.Revision = hex.EncodeToString(nonce), 1
		status = 201
	} else {
		if item.Revision != items[index].Revision {
			writeError(w, 409, fmt.Errorf("project changed; reload before saving"))
			return
		}
		item.ID, item.Revision = id, item.Revision+1
	}
	item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if id == "" {
		items = append(items, item)
	} else {
		items[index] = item
	}
	if err := atomicJSON(filepath.Join(s.Config.ConfigDir, "projects.json"), items); err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, status, item)
}
