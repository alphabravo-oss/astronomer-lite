package kubeconfig

import (
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func TestUserScopeAndImportRestrictions(t *testing.T) {
	root := t.TempDir()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := NewRegistry(nil, filepath.Join(root, "alice"), "", logger)
	a.SetUserScope("alice")
	a.SetAllowedServers([]string{"https://cluster.example"})
	b := NewRegistry(nil, filepath.Join(root, "bob"), "", logger)
	b.SetUserScope("bob")
	b.SetAllowedServers([]string{"https://cluster.example"})
	cfg := clientcmdapi.NewConfig()
	cfg.Clusters["cluster"] = &clientcmdapi.Cluster{Server: "https://cluster.example"}
	cfg.Contexts["context"] = &clientcmdapi.Context{Cluster: "cluster", AuthInfo: "user"}
	cfg.AuthInfos["user"] = &clientcmdapi.AuthInfo{Token: "test"}
	raw, _ := clientcmd.Write(*cfg)
	pa, err := a.Preview(raw)
	if err != nil {
		t.Fatal(err)
	}
	pb, err := b.Preview(raw)
	if err != nil {
		t.Fatal(err)
	}
	if pa[0].ID == pb[0].ID {
		t.Fatal("cross-user cluster IDs collide")
	}
	cases := []struct {
		name   string
		modify func(*clientcmdapi.Config)
	}{
		{"exec", func(c *clientcmdapi.Config) { c.AuthInfos["user"].Exec = &clientcmdapi.ExecConfig{Command: "sh"} }},
		{"token file", func(c *clientcmdapi.Config) { c.AuthInfos["user"].TokenFile = "/private" }},
		{"certificate file", func(c *clientcmdapi.Config) { c.AuthInfos["user"].ClientCertificate = "/private" }},
		{"key file", func(c *clientcmdapi.Config) { c.AuthInfos["user"].ClientKey = "/private" }},
		{"auth provider", func(c *clientcmdapi.Config) {
			c.AuthInfos["user"].AuthProvider = &clientcmdapi.AuthProviderConfig{Name: "gcp"}
		}},
		{"CA file", func(c *clientcmdapi.Config) { c.Clusters["cluster"].CertificateAuthority = "/private" }},
		{"proxy", func(c *clientcmdapi.Config) { c.Clusters["cluster"].ProxyURL = "http://127.0.0.1" }},
		{"unapproved server", func(c *clientcmdapi.Config) { c.Clusters["cluster"].Server = "https://unapproved.example" }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			copy := cfg.DeepCopy()
			test.modify(copy)
			raw, _ := clientcmd.Write(*copy)
			if _, err := a.Preview(raw); err == nil {
				t.Fatal("preview accepted unsafe config")
			}
			if _, err := a.AddManaged(raw, nil); err == nil {
				t.Fatal("import accepted unsafe config")
			}
		})
	}
}
