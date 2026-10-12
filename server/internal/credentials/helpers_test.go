package credentials

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCredentialHelperProcess(t *testing.T) {
	if os.Getenv("LITE_HELPER_TEST") != "1" {
		return
	}
	if os.Getenv("AWS_SECRET_ACCESS_KEY") != "" || os.Getenv("HOME") != os.Getenv("EXPECTED_HOME") || os.Getenv("USERPROFILE") != os.Getenv("HOME") {
		os.Exit(4)
	}
	if os.Getenv("FAIL_HELPER") == "1" {
		fmt.Fprintln(os.Stderr, "secret that must not reach the browser")
		os.Exit(5)
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"apiVersion": "client.authentication.k8s.io/v1", "kind": "ExecCredential", "status": map[string]any{"token": "private-user-token", "expirationTimestamp": time.Now().Add(time.Hour)}})
	os.Exit(0)
}
func TestApprovedHelpersIsolateEnvironmentAndIdentity(t *testing.T) {
	t.Setenv("AWS_SECRET_ACCESS_KEY", "ambient-operator-secret")
	user := strings.Repeat("a", 64)
	home := filepath.Join(t.TempDir(), "private-home")
	path := filepath.Join(t.TempDir(), "helpers.json")
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	policy := Policy{Helpers: []Helper{{ID: "aws", Users: []string{user}, Servers: []string{"https://cluster.example"}, Command: executable, Args: []string{"-test.run=^TestCredentialHelperProcess$"}, Env: map[string]string{"LITE_HELPER_TEST": "1", "EXPECTED_HOME": home}}}}
	write := func() {
		t.Helper()
		data, _ := json.Marshal(policy)
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write()
	if _, err := Run(t.Context(), path, "aws", strings.Repeat("b", 64), "https://cluster.example", home); err == nil {
		t.Fatal("cross-user helper allowed")
	}
	if _, err := Run(t.Context(), path, "aws", user, "https://other.example", home); err == nil {
		t.Fatal("cross-cluster helper allowed")
	}
	out, err := Run(t.Context(), path, "aws", user, "https://cluster.example", home)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), "private-user-token") {
		t.Fatal("missing credential")
	}
	policy.Helpers[0].Env["FAIL_HELPER"] = "1"
	write()
	if _, err = Run(t.Context(), path, "aws", user, "https://cluster.example", home); err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatal("helper error exposed diagnostics", err)
	}
}
