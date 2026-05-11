package kubeconfig

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/version"
)

func TestProbeReachabilityStatus(t *testing.T) {
	tests := []struct {
		name       string
		handler    http.HandlerFunc
		wantStatus ReachabilityStatus
		wantReach  bool
	}{
		{
			name: "reachable",
			handler: func(w http.ResponseWriter, r *http.Request) {
				assertUserAgent(t, r)
				writeDiscoveryResponse(t, w, r, false)
			},
			wantStatus: StatusReachable,
			wantReach:  true,
		},
		{
			name: "degraded when version succeeds but discovery fails",
			handler: func(w http.ResponseWriter, r *http.Request) {
				assertUserAgent(t, r)
				writeDiscoveryResponse(t, w, r, true)
			},
			wantStatus: StatusDegraded,
			wantReach:  true,
		},
		{
			name: "unreachable when version fails",
			handler: func(w http.ResponseWriter, r *http.Request) {
				assertUserAgent(t, r)
				if r.URL.Path == "/version" {
					http.Error(w, "api server unavailable", http.StatusServiceUnavailable)
					return
				}
				writeDiscoveryResponse(t, w, r, false)
			},
			wantStatus: StatusUnreachable,
			wantReach:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewTLSServer(tt.handler)
			t.Cleanup(server.Close)
			registry := registryForTest(t, server.URL)

			registry.ReloadAndProbe(context.Background())
			clusters := registry.List()
			if len(clusters) != 1 {
				t.Fatalf("List() returned %d clusters, want 1", len(clusters))
			}
			cluster := clusters[0]
			if cluster.Status != string(tt.wantStatus) {
				t.Fatalf("cluster.Status = %q, want %q; error=%q", cluster.Status, tt.wantStatus, cluster.Error)
			}
			if cluster.Reachable != tt.wantReach {
				t.Fatalf("cluster.Reachable = %v, want %v", cluster.Reachable, tt.wantReach)
			}
			if tt.wantStatus == StatusReachable && cluster.Version != "v1.30.0" {
				t.Fatalf("cluster.Version = %q, want v1.30.0", cluster.Version)
			}
			cfg, err := registry.RESTConfig(cluster.ID)
			if err != nil {
				t.Fatal(err)
			}
			if cfg.UserAgent != version.UserAgent() {
				t.Fatalf("RESTConfig().UserAgent = %q, want %q", cfg.UserAgent, version.UserAgent())
			}
		})
	}
}

func TestStartProbesInBackground(t *testing.T) {
	requests := make(chan string, 4)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.URL.Path
		if r.URL.Path == "/version" {
			time.Sleep(300 * time.Millisecond)
		}
		writeDiscoveryResponse(t, w, r, false)
	}))
	t.Cleanup(server.Close)
	registry := registryForTest(t, server.URL)
	if err := registry.Reload(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	started := time.Now()
	registry.Start(ctx)
	if elapsed := time.Since(started); elapsed > 100*time.Millisecond {
		t.Fatalf("Start blocked for %s, want background probing to return quickly", elapsed)
	}

	select {
	case path := <-requests:
		if path != "/version" {
			t.Fatalf("first probe request path = %q, want /version", path)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("background probe did not reach API server")
	}
}

func assertUserAgent(t *testing.T, r *http.Request) {
	t.Helper()
	if got := r.Header.Get("User-Agent"); got != version.UserAgent() {
		t.Fatalf("%s User-Agent = %q, want %q", r.URL.Path, got, version.UserAgent())
	}
}

func TestPreviewAndAddManagedSelectedContexts(t *testing.T) {
	dir := t.TempDir()
	managedDir := filepath.Join(dir, "clusters.d")
	if err := os.MkdirAll(managedDir, 0o700); err != nil {
		t.Fatal(err)
	}
	raw := []byte(`apiVersion: v1
kind: Config
clusters:
- name: first-cluster
  cluster:
    server: https://first.example
- name: second-cluster
  cluster:
    server: https://second.example
contexts:
- name: first
  context:
    cluster: first-cluster
    user: first-user
- name: second
  context:
    cluster: second-cluster
    user: second-user
current-context: second
users:
- name: first-user
  user:
    token: first-token
- name: second-user
  user:
    token: second-token
`)

	registry := NewRegistry(nil, managedDir, slog.New(slog.NewTextHandler(io.Discard, nil)))
	contexts, err := registry.Preview(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 2 {
		t.Fatalf("Preview returned %d contexts, want 2", len(contexts))
	}
	if contexts[0].Name != "second" || !contexts[0].Current {
		t.Fatalf("Preview first context = %#v, want current context second first", contexts[0])
	}

	clusters, err := registry.AddManaged(raw, []string{"first"})
	if err != nil {
		t.Fatal(err)
	}
	if len(clusters) != 1 {
		t.Fatalf("AddManaged selected returned %d clusters, want 1", len(clusters))
	}
	if clusters[0].Context != "first" || clusters[0].Server != "https://first.example" {
		t.Fatalf("selected cluster = %#v, want first context only", clusters[0])
	}

	contexts, err = registry.Preview(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !contexts[1].AlreadyExists {
		t.Fatalf("Preview after add did not mark existing context: %#v", contexts)
	}
	if _, err := registry.AddManaged(raw, []string{"first"}); err == nil {
		t.Fatal("AddManaged duplicate selected context succeeded, want error")
	}
}

func TestAddManagedDoesNotMutateSystemKubeconfigAndDeleteIsScoped(t *testing.T) {
	dir := t.TempDir()
	systemPath := filepath.Join(dir, "system.yaml")
	managedDir := filepath.Join(dir, "clusters.d")
	if err := os.MkdirAll(managedDir, 0o700); err != nil {
		t.Fatal(err)
	}
	systemRaw := []byte(`apiVersion: v1
kind: Config
clusters:
- name: system-cluster
  cluster:
    server: https://system.example
contexts:
- name: system
  context:
    cluster: system-cluster
    user: system-user
current-context: system
users:
- name: system-user
  user:
    token: system-token
`)
	if err := os.WriteFile(systemPath, systemRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	managedRaw := []byte(`apiVersion: v1
kind: Config
clusters:
- name: managed-cluster
  cluster:
    server: https://managed.example
contexts:
- name: managed
  context:
    cluster: managed-cluster
    user: managed-user
current-context: managed
users:
- name: managed-user
  user:
    token: managed-token
`)

	registry := NewRegistry([]string{systemPath}, managedDir, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := registry.Reload(); err != nil {
		t.Fatal(err)
	}
	clusters, err := registry.AddManaged(managedRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(systemPath); err != nil {
		t.Fatal(err)
	} else if string(got) != string(systemRaw) {
		t.Fatalf("system kubeconfig was mutated\n got: %s\nwant: %s", got, systemRaw)
	}
	entries, err := os.ReadDir(managedDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("managedDir entries = %d, want 1", len(entries))
	}
	info, err := entries[0].Info()
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("managed kubeconfig mode = %v, want 0600", info.Mode().Perm())
	}

	var systemCluster, managedCluster Cluster
	for _, cluster := range clusters {
		switch cluster.Context {
		case "system":
			systemCluster = cluster
		case "managed":
			managedCluster = cluster
		}
	}
	if systemCluster.ID == "" || managedCluster.ID == "" {
		t.Fatalf("clusters after add = %#v, want system and managed contexts", clusters)
	}
	if err := registry.Delete(systemCluster.ID); err == nil {
		t.Fatal("Delete(system cluster) succeeded, want scoped delete refusal")
	}
	if err := registry.Delete(managedCluster.ID); err != nil {
		t.Fatal(err)
	}
	entries, err = os.ReadDir(managedDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("managedDir entries after delete = %d, want 0", len(entries))
	}
}

func TestReloadReportsMissingExecPluginClearly(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", filepath.Join(dir, "empty-bin"))
	kubeconfigPath := filepath.Join(dir, "config.yaml")
	managedDir := filepath.Join(dir, "clusters.d")
	if err := os.MkdirAll(managedDir, 0o700); err != nil {
		t.Fatal(err)
	}
	raw := `apiVersion: v1
kind: Config
clusters:
- name: test
  cluster:
    server: https://example.invalid
contexts:
- name: test
  context:
    cluster: test
    user: test
current-context: test
users:
- name: test
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: gke-gcloud-auth-plugin
`
	if err := os.WriteFile(kubeconfigPath, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	registry := NewRegistry([]string{kubeconfigPath}, managedDir, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := registry.Reload(); err != nil {
		t.Fatal(err)
	}
	clusters := registry.List()
	if len(clusters) != 1 {
		t.Fatalf("List() returned %d clusters, want 1", len(clusters))
	}
	cluster := clusters[0]
	if cluster.Status != string(StatusUnreachable) {
		t.Fatalf("cluster.Status = %q, want %q", cluster.Status, StatusUnreachable)
	}
	want := "Exec plugin `gke-gcloud-auth-plugin` not found on PATH"
	if cluster.Error != want {
		t.Fatalf("cluster.Error = %q, want %q", cluster.Error, want)
	}
}

func registryForTest(t *testing.T, serverURL string) *Registry {
	t.Helper()
	dir := t.TempDir()
	kubeconfigPath := filepath.Join(dir, "config.yaml")
	managedDir := filepath.Join(dir, "clusters.d")
	if err := os.MkdirAll(managedDir, 0o700); err != nil {
		t.Fatal(err)
	}
	raw := fmt.Sprintf(`apiVersion: v1
kind: Config
clusters:
- name: test
  cluster:
    server: %s
    insecure-skip-tls-verify: true
contexts:
- name: test
  context:
    cluster: test
    user: test
current-context: test
users:
- name: test
  user:
    token: test-token
`, serverURL)
	if err := os.WriteFile(kubeconfigPath, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	return NewRegistry([]string{kubeconfigPath}, managedDir, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func writeDiscoveryResponse(t *testing.T, w http.ResponseWriter, r *http.Request, failDiscovery bool) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	switch r.URL.Path {
	case "/version":
		_, _ = w.Write([]byte(`{"major":"1","minor":"30","gitVersion":"v1.30.0"}`))
	case "/api":
		if failDiscovery {
			http.Error(w, "discovery unavailable", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"kind":"APIVersions","apiVersion":"v1","versions":["v1"],"serverAddressByClientCIDRs":[]}`))
	case "/apis":
		if failDiscovery {
			http.Error(w, "discovery unavailable", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"kind":"APIGroupList","apiVersion":"v1","groups":[]}`))
	default:
		http.NotFound(w, r)
	}
}
