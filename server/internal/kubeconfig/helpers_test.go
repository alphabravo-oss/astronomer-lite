package kubeconfig

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alphabravo/astronomer-lite/server/internal/credentials"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func TestServerHelperSelectionNeverAcceptsExecutableArguments(t *testing.T) {
	root := t.TempDir()
	user := strings.Repeat("a", 64)
	r := NewRegistry(nil, filepath.Join(root, "clusters.d"), "", slog.New(slog.NewTextHandler(io.Discard, nil)))
	r.SetUserScope(user)
	r.SetAllowedServers([]string{"https://cluster.example"})
	policy := credentials.Policy{Helpers: []credentials.Helper{{ID: "cloud", Users: []string{user}, Servers: []string{"https://cluster.example"}, Command: "/operator/cloud-helper"}}}
	data, _ := json.Marshal(policy)
	file := filepath.Join(root, "helpers.json")
	if err := os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	r.SetCredentialHelpers(file)
	c := clientcmdapi.NewConfig()
	c.Clusters["cluster"] = &clientcmdapi.Cluster{Server: "https://cluster.example"}
	c.Contexts["context"] = &clientcmdapi.Context{Cluster: "cluster", AuthInfo: "user"}
	c.AuthInfos["user"] = &clientcmdapi.AuthInfo{Exec: &clientcmdapi.ExecConfig{Command: helperPrefix + "cloud", APIVersion: "client.authentication.k8s.io/v1", InteractiveMode: clientcmdapi.NeverExecInteractiveMode}}
	if err := r.validateImport(c); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*clientcmdapi.ExecConfig){func(e *clientcmdapi.ExecConfig) { e.Command = "sh" }, func(e *clientcmdapi.ExecConfig) { e.Args = []string{"--steal"} }, func(e *clientcmdapi.ExecConfig) {
		e.Env = []clientcmdapi.ExecEnvVar{{Name: "HOME", Value: "/operator"}}
	}, func(e *clientcmdapi.ExecConfig) { e.ProvideClusterInfo = true }} {
		copy := c.DeepCopy()
		mutate(copy.AuthInfos["user"].Exec)
		if r.validateImport(copy) == nil {
			t.Fatal("untrusted helper configuration accepted")
		}
	}
	if err := r.prepareHelpers(c); err != nil {
		t.Fatal(err)
	}
	e := c.AuthInfos["user"].Exec
	if e.Command == "/operator/cloud-helper" || len(e.Args) != 6 || e.Args[3] != user || !strings.Contains(e.Args[5], "helper-homes") {
		t.Fatal("helper bypassed private wrapper", e)
	}
}
