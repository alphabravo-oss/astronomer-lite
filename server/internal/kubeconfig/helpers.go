package kubeconfig

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/alphabravo/astronomer-lite/server/internal/credentials"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

const helperPrefix = "astronomer-lite-helper:"

func (r *Registry) validateHelper(cfg *clientcmdapi.Config, name string) error {
	u := cfg.AuthInfos[name]
	e := u.Exec
	if !strings.HasPrefix(e.Command, helperPrefix) || len(e.Args) != 0 || len(e.Env) != 0 || e.ProvideClusterInfo || e.InteractiveMode != clientcmdapi.NeverExecInteractiveMode || e.APIVersion != "client.authentication.k8s.io/v1" || e.Config != nil || u.Token != "" || u.ClientCertificateData != nil || u.ClientKeyData != nil {
		return errors.New("server mode permits only approved helper IDs with v1, interactiveMode Never, and no user-supplied arguments or environment")
	}
	id := strings.TrimPrefix(e.Command, helperPrefix)
	used := false
	for _, c := range cfg.Contexts {
		if c.AuthInfo != name {
			continue
		}
		used = true
		cluster := cfg.Clusters[c.Cluster]
		if cluster == nil {
			return errors.New("helper cluster missing")
		}
		if _, err := credentials.Lookup(r.helperPolicy, id, r.scope, cluster.Server); err != nil {
			return err
		}
	}
	if !used {
		return errors.New("credential helper has no cluster context")
	}
	return nil
}
func (r *Registry) prepareHelpers(cfg *clientcmdapi.Config) error {
	policy, err := filepath.Abs(r.helperPolicy)
	if err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	for name, u := range cfg.AuthInfos {
		if u.Exec == nil {
			continue
		}
		id := strings.TrimPrefix(u.Exec.Command, helperPrefix)
		// A single auth entry may not be reused across differently approved API URLs.
		server := ""
		for _, c := range cfg.Contexts {
			if c.AuthInfo == name {
				next := cfg.Clusters[c.Cluster].Server
				if server != "" && server != next {
					return errors.New("use a separate helper auth entry for each cluster")
				}
				server = next
			}
		}
		home, err := filepath.Abs(filepath.Join(r.managedDir, "..", "helper-homes", id))
		if err != nil {
			return err
		}
		u.Exec = &clientcmdapi.ExecConfig{Command: executable, Args: []string{"credential-helper", policy, id, r.scope, server, home}, APIVersion: "client.authentication.k8s.io/v1", InteractiveMode: clientcmdapi.NeverExecInteractiveMode}
	}
	return nil
}
