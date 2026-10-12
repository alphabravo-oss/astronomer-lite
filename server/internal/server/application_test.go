package server

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestServerModeWorkspaceIsolation(t *testing.T) {
	t.Setenv("ASTRONOMER_LITE_PLUGINS_ENABLED", "true")
	dir := t.TempDir()
	passwordFile := filepath.Join(dir, "bootstrap")
	_ = os.WriteFile(passwordFile, []byte("test-only-password-1234"), 0600)
	t.Setenv("ASTRONOMER_LITE_CONFIG_DIR", dir)
	t.Setenv("ASTRONOMER_LITE_AUTH_MODE", "server")
	t.Setenv("ASTRONOMER_LITE_PUBLIC_URL", "https://lite.example")
	t.Setenv("ASTRONOMER_LITE_ADMIN_USER", "admin")
	t.Setenv("ASTRONOMER_LITE_ADMIN_PASSWORD_FILE", passwordFile)
	t.Setenv("ASTRONOMER_LITE_ALLOWED_CLUSTER_SERVERS", "https://127.0.0.1:1")
	t.Setenv("ASTRONOMER_LITE_OIDC_ISSUER", "")
	t.Setenv("ASTRONOMER_LITE_OIDC_CLIENT_ID", "")
	t.Setenv("ASTRONOMER_LITE_OIDC_CLIENT_SECRET_FILE", "")
	pluginDir := filepath.Join(dir, "plugins", "settings-test")
	if err := os.MkdirAll(pluginDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pluginDir, "plugin.json"), []byte(`{"id":"settings-test","name":"Settings test","version":"1.0.0","entry":"index.html","permissions":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pluginDir, "index.html"), []byte("<p>Settings</p>"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ASTRONOMER_LITE_PLUGINS_DIR", filepath.Dir(pluginDir))
	app, err := NewApplication(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	call := func(method, path string, body []byte, cookie *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "https://lite.example"+path, bytes.NewReader(body))
		r.Header.Set("X-Astronomer-Lite", "1")
		r.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		app.Routes().ServeHTTP(w, r)
		return w
	}
	login := func(username string) *http.Cookie {
		w := call("POST", "/api/auth/login", []byte(`{"username":"`+username+`","password":"test-only-password-1234"}`), nil)
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		return w.Result().Cookies()[0]
	}
	if w := call("GET", "/api/clusters", nil, nil); w.Code != 401 {
		t.Fatal("anonymous API accepted")
	}
	admin := login("admin")
	if w := call("POST", "/api/auth/users", []byte(`{"username":"alice","password":"test-only-password-1234","role":"user"}`), admin); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	alice := login("alice")
	settingsURL := "/api/extensions/settings-test/settings"
	if w := call("PUT", settingsURL, []byte(`{"private":"admin"}`), admin); w.Code != 403 {
		t.Fatal("disabled plugin settings accepted", w.Code)
	}
	if w := call("PATCH", "/api/extensions/settings-test", []byte(`{"enabled":true}`), admin); w.Code != 204 {
		t.Fatal("enable plugin", w.Body.String())
	}
	if w := call("PUT", settingsURL, []byte(`{"private":"admin"}`), admin); w.Code != 204 {
		t.Fatal("save admin settings", w.Body.String())
	}
	if w := call("GET", settingsURL, nil, alice); w.Code != 200 || w.Body.String() != "{}\n" {
		t.Fatal("plugin settings crossed workspace boundary", w.Body.String())
	}
	if w := call("PUT", settingsURL, []byte(`{"private":"alice"}`), alice); w.Code != 204 {
		t.Fatal("save user settings", w.Body.String())
	}
	if w := call("GET", settingsURL, nil, admin); w.Body.String() != `{"private":"admin"}` {
		t.Fatal("user overwrote admin settings", w.Body.String())
	}
	if w := call("PUT", settingsURL, []byte(`[]`), alice); w.Code != 400 {
		t.Fatal("accepted non-object settings")
	}

	config := []byte(`apiVersion: v1
kind: Config
clusters:
- name: example
  cluster:
    server: https://127.0.0.1:1
    insecure-skip-tls-verify: true
users:
- name: user
  user:
    token: test
contexts:
- name: example
  context:
    cluster: example
    user: user
current-context: example
`)
	w := call("POST", "/api/clusters", config, admin)
	if w.Code != 201 {
		t.Fatal(w.Body.String())
	}
	var adminClusters []struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &adminClusters)
	if len(adminClusters) != 1 {
		t.Fatal("host clusters leaked into server mode")
	}
	w = call("GET", "/api/clusters", nil, alice)
	if w.Code != 200 || w.Body.String() != "[]\n" {
		t.Fatal("another user's clusters are visible", w.Body.String())
	}
	for _, method := range []string{"GET", "DELETE"} {
		w = call(method, "/api/clusters/"+adminClusters[0].ID, nil, alice)
		if w.Code != 404 {
			t.Fatal("another user's cluster accessible", w.Code)
		}
	}
	w = call("POST", "/api/clusters", config, alice)
	if w.Code != 201 {
		t.Fatal(w.Body.String())
	}
	var aliceClusters []struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &aliceClusters)
	if aliceClusters[0].ID == adminClusters[0].ID {
		t.Fatal("cache keys collide between users")
	}
	w = call("GET", "/api/auth/users", nil, alice)
	if w.Code != 403 {
		t.Fatal("ordinary user can administer accounts")
	}
	payload, _ := json.Marshal(map[string]any{"name": "Admin project", "scopes": []projectScope{{ClusterID: adminClusters[0].ID, Namespace: "default"}}})
	w = call("POST", "/api/projects", payload, admin)
	if w.Code != 201 {
		t.Fatal("create project", w.Code, w.Body.String())
	}
	var saved project
	if err := json.Unmarshal(w.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"GET", "DELETE", "PUT"} {
		if other := call(method, "/api/projects/"+saved.ID, payload, alice); other.Code != 404 {
			t.Fatal("project crossed workspace boundary", other.Code)
		}
	}
	if other := call("POST", "/api/projects", payload, alice); other.Code != 400 {
		t.Fatal("accepted another user's cluster in a project", other.Code)
	}
	if listed := call("GET", "/api/projects", nil, alice); listed.Body.String() != "[]\n" {
		t.Fatal("project listing leaked")
	}
	saved.Description = "changed"
	payload, _ = json.Marshal(saved)
	if updated := call("PUT", "/api/projects/"+saved.ID, payload, admin); updated.Code != 200 {
		t.Fatal("project update failed", updated.Body.String())
	}
	if stale := call("PUT", "/api/projects/"+saved.ID, payload, admin); stale.Code != 409 {
		t.Fatal("accepted stale revision")
	}
	for _, workspace := range app.workspaces {
		stored, err := workspace.readProjects()
		if err != nil {
			t.Fatal(err)
		}
		if len(stored) > 0 && (stored[0].Revision != 2 || stored[0].Description != "changed") {
			t.Fatal("project was not persisted")
		}
	}
}

// Deferred plugins must not load a catalog or expose any endpoint by default,
// including when configuration from an earlier plugin-enabled run is present.
func TestPluginsDisabledByDefault(t *testing.T) {
	t.Setenv("ASTRONOMER_LITE_CONFIG_DIR", t.TempDir())
	t.Setenv("KUBECONFIG", filepath.Join(t.TempDir(), "missing"))
	t.Setenv("ASTRONOMER_LITE_AUTH_MODE", "single-user")
	t.Setenv("ASTRONOMER_LITE_PLUGINS_ENABLED", "")
	t.Setenv("ASTRONOMER_LITE_FORWARD_DOMAIN", "")
	t.Setenv("ASTRONOMER_LITE_PLUGIN_CATALOG_URL", "not-a-url")
	t.Setenv("ASTRONOMER_LITE_PLUGIN_TRUST_KEY_FILE", "missing-key")
	app, err := NewApplication(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	for _, endpoint := range []struct{ method, path string }{
		{"GET", "/api/extensions"},
		{"GET", "/api/extensions/_catalog"},
		{"POST", "/api/extensions/_install"},
		{"PATCH", "/api/extensions/example"},
		{"GET", "/api/extensions/example/content"},
		{"PUT", "/api/extensions/example/settings"},
		{"POST", "/api/extensions/example/resources"},
	} {
		w := httptest.NewRecorder()
		app.Routes().ServeHTTP(w, httptest.NewRequest(endpoint.method, endpoint.path, nil))
		if w.Code != http.StatusNotFound {
			t.Errorf("%s %s: got %d", endpoint.method, endpoint.path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	app.Routes().ServeHTTP(w, httptest.NewRequest("GET", "/api/auth/session", nil))
	var session struct {
		Plugins bool `json:"plugins"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.Plugins || app.workspaces[""].extensions != nil {
		t.Fatal("plugins loaded without opt-in")
	}
}
