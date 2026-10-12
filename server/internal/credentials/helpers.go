// Package credentials runs only operator-defined credential commands. Imported
// kubeconfigs select a policy ID; they never supply executable paths or arguments.
package credentials

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
)

type Helper struct {
	ID      string            `json:"id"`
	Users   []string          `json:"users"`
	Servers []string          `json:"servers"`
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env"`
}
type Policy struct {
	Helpers []Helper `json:"helpers"`
}

var ID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
var userID = regexp.MustCompile(`^[a-f0-9]{64}$`)

func Lookup(path, id, user, server string) (Helper, error) {
	if path == "" || !ID.MatchString(id) || !userID.MatchString(user) {
		return Helper{}, errors.New("credential helper is not approved")
	}
	f, err := os.Open(path)
	if err != nil {
		return Helper{}, errors.New("cannot read credential helper policy")
	}
	defer func() { _ = f.Close() }()
	var policy Policy
	d := json.NewDecoder(io.LimitReader(f, 256<<10))
	d.DisallowUnknownFields()
	if d.Decode(&policy) != nil || len(policy.Helpers) > 64 {
		return Helper{}, errors.New("invalid credential helper policy")
	}
	for _, h := range policy.Helpers {
		if h.ID != id {
			continue
		}
		if !slices.Contains(h.Users, user) || !slices.Contains(h.Servers, server) || !filepath.IsAbs(h.Command) || len(h.Args) > 64 {
			return Helper{}, errors.New("credential helper is not approved for this identity and cluster")
		}
		for k, v := range h.Env {
			if k == "" || strings.ContainsAny(k, "=\x00") || strings.ContainsRune(v, 0) || slices.Contains([]string{"HOME", "USERPROFILE", "KUBERNETES_EXEC_INFO", "ASTRONOMER_LITE_DESKTOP_TOKEN"}, k) {
				return Helper{}, errors.New("invalid credential helper environment")
			}
		}
		return h, nil
	}
	return Helper{}, errors.New("unknown credential helper")
}

type boundedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.limit {
		return 0, errors.New("credential helper output exceeds limit")
	}
	return b.Buffer.Write(p)
}

// Run returns a validated ExecCredential. No ambient cloud credentials or shell
// variables are inherited; each user's helper gets a separate private home.
func Run(ctx context.Context, policy, id, user, server, home string) ([]byte, error) {
	h, err := Lookup(policy, id, user, server)
	if err != nil {
		return nil, err
	}
	if !filepath.IsAbs(home) {
		return nil, errors.New("credential helper requires an absolute home")
	}
	if err := os.MkdirAll(home, 0700); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, h.Command, h.Args...)
	cmd.Dir = home
	cmd.Env = []string{"HOME=" + home, "USERPROFILE=" + home, "KUBERNETES_EXEC_INFO={\"apiVersion\":\"client.authentication.k8s.io/v1\",\"kind\":\"ExecCredential\",\"spec\":{\"interactive\":false}}"}
	for k, v := range h.Env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	output := &boundedBuffer{limit: 1 << 20}
	cmd.Stdout = output
	// Helpers may print sensitive tokens in diagnostic errors; do not relay them.
	cmd.Stderr = io.Discard
	cmd.WaitDelay = time.Second
	if err := cmd.Run(); err != nil {
		return nil, errors.New("approved credential helper failed")
	}
	var credential struct {
		APIVersion string `json:"apiVersion"`
		Kind       string `json:"kind"`
		Status     struct {
			Token       string    `json:"token"`
			Certificate string    `json:"clientCertificateData"`
			Key         string    `json:"clientKeyData"`
			Expiry      time.Time `json:"expirationTimestamp"`
		} `json:"status"`
	}
	if json.Unmarshal(output.Bytes(), &credential) != nil || credential.Kind != "ExecCredential" || credential.APIVersion != "client.authentication.k8s.io/v1" {
		return nil, errors.New("helper returned invalid ExecCredential")
	}
	s := credential.Status
	if time.Until(s.Expiry) <= 0 || time.Until(s.Expiry) > 24*time.Hour {
		return nil, errors.New("helper credentials require an expiry within 24 hours")
	}
	if s.Token != "" {
		if s.Certificate != "" || s.Key != "" || strings.ContainsAny(s.Token, "\r\n") {
			return nil, errors.New("invalid helper token")
		}
	} else if _, err := tls.X509KeyPair([]byte(s.Certificate), []byte(s.Key)); err != nil {
		return nil, errors.New("helper returned no valid credentials")
	}
	return output.Bytes(), nil
}

func Main(args []string) error {
	if len(args) != 5 {
		return fmt.Errorf("credential-helper requires policy, helper ID, user ID, server, and private home")
	}
	out, err := Run(context.Background(), args[0], args[1], args[2], args[3], args[4])
	if err != nil {
		return err
	}
	_, err = os.Stdout.Write(out)
	return err
}
