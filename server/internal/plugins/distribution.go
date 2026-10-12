package plugins

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/mod/semver"
)

type SignedEnvelope struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}
type Package struct {
	Manifest Extension `json:"manifest"`
	HTML     string    `json:"html"`
}
type PackageListing struct {
	Manifest Extension `json:"manifest"`
	URL      string    `json:"url"`
	SHA256   string    `json:"sha256"`
}
type PackageIndex struct {
	Version  int              `json:"version"`
	Packages []PackageListing `json:"packages"`
}

func (c *Catalog) ConfigureDistribution(catalogURL, keyFile string) error {
	if catalogURL == "" && keyFile == "" {
		return nil
	}
	if c.dir == "" {
		return errors.New("plugin distribution requires a writable plugins directory")
	}
	if _, err := distributionURL(catalogURL); err != nil {
		return err
	}
	data, err := os.ReadFile(keyFile)
	if err != nil {
		return err
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(data)))
	if err != nil || len(key) != ed25519.PublicKeySize {
		return errors.New("plugin trust key must be a base64 Ed25519 public key")
	}
	c.catalogURL, c.trustKey = catalogURL, ed25519.PublicKey(key)
	return nil
}
func (c *Catalog) DistributionEnabled() bool { return c.catalogURL != "" }
func distributionURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" {
		return nil, errors.New("invalid plugin distribution URL")
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && (!local || u.Scheme != "http") {
		return nil, errors.New("plugin distribution requires HTTPS except on loopback")
	}
	return u, nil
}
func download(ctx context.Context, raw string) ([]byte, error) {
	if _, err := distributionURL(raw); err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	r, err := http.NewRequestWithContext(ctx, "GET", raw, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(r)
	if err != nil {
		return nil, errors.New("plugin download failed")
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != 200 {
		return nil, fmt.Errorf("plugin download returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (8<<20)+1))
	if err != nil || len(data) > 8<<20 {
		return nil, errors.New("plugin download exceeds 8 MiB or could not be read")
	}
	return data, nil
}
func verifySigned(data []byte, key ed25519.PublicKey, out any) error {
	var envelope SignedEnvelope
	if json.Unmarshal(data, &envelope) != nil {
		return errors.New("invalid signed plugin envelope")
	}
	payload, e1 := base64.StdEncoding.DecodeString(envelope.Payload)
	signature, e2 := base64.StdEncoding.DecodeString(envelope.Signature)
	if e1 != nil || e2 != nil || !ed25519.Verify(key, payload, signature) {
		return errors.New("plugin signature is invalid")
	}
	if json.Unmarshal(payload, out) != nil {
		return errors.New("invalid signed plugin payload")
	}
	return nil
}
func (c *Catalog) Available(ctx context.Context) (PackageIndex, error) {
	var index PackageIndex
	if !c.DistributionEnabled() {
		return index, errors.New("plugin catalog is not configured")
	}
	data, err := download(ctx, c.catalogURL)
	if err != nil {
		return index, err
	}
	if err = verifySigned(data, c.trustKey, &index); err != nil {
		return index, err
	}
	if index.Version != 1 || len(index.Packages) > 128 {
		return index, errors.New("unsupported plugin catalog")
	}
	seen := map[string]bool{}
	for _, p := range index.Packages {
		if err := validateExtension(p.Manifest); err != nil {
			return index, err
		}
		if !semver.IsValid("v"+p.Manifest.Version) || len(p.SHA256) != 64 {
			return index, errors.New("catalog package requires semantic version and SHA256")
		}
		if _, err := hex.DecodeString(p.SHA256); err != nil {
			return index, errors.New("invalid package SHA256")
		}
		if _, err := distributionURL(p.URL); err != nil {
			return index, err
		}
		key := p.Manifest.ID + "@" + p.Manifest.Version
		if seen[key] {
			return index, errors.New("duplicate package version")
		}
		seen[key] = true
	}
	return index, nil
}
func (c *Catalog) Install(ctx context.Context, id, version, digest string) error {
	c.installMu.Lock()
	defer c.installMu.Unlock()
	index, err := c.Available(ctx)
	if err != nil {
		return err
	}
	var selected *PackageListing
	for _, p := range index.Packages {
		if p.Manifest.ID == id && p.Manifest.Version == version && p.SHA256 == digest {
			copy := p
			selected = &copy
			break
		}
	}
	if selected == nil {
		return errors.New("catalog changed; review the package again")
	}
	data, err := download(ctx, selected.URL)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != digest {
		return errors.New("package digest does not match catalog")
	}
	var pkg Package
	if err = verifySigned(data, c.trustKey, &pkg); err != nil {
		return err
	}
	left, _ := json.Marshal(pkg.Manifest)
	right, _ := json.Marshal(selected.Manifest)
	if string(left) != string(right) || len(pkg.HTML) > 2<<20 {
		return errors.New("package contents do not match reviewed manifest or exceed size limit")
	}
	e := pkg.Manifest
	e.Enabled = false
	e.HTML = pkg.HTML
	c.mu.Lock()
	defer c.mu.Unlock()
	if old, ok := c.entries[id]; ok {
		if !semver.IsValid("v"+old.Version) || semver.Compare("v"+version, "v"+old.Version) <= 0 {
			return errors.New("updates require a newer semantic version")
		}
		if c.paths[id] != id {
			return errors.New("move this operator-installed plugin to a directory matching its ID before updating")
		}
	} else if len(c.entries) >= 64 {
		return errors.New("plugin limit reached")
	}
	root, err := os.OpenRoot(c.dir)
	if err != nil {
		return err
	}
	defer func() { _ = root.Close() }()
	if err = root.Mkdir(id, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	// Disable before replacing any code. A permission expansion always requires
	// another explicit enable operation, and a failed update stays disabled.
	states := map[string]bool{}
	for id, p := range c.entries {
		states[id] = p.Enabled
	}
	states[id] = false
	if err = c.writeStates(states); err != nil {
		return err
	}
	if old, ok := c.entries[id]; ok {
		old.Enabled = false
		c.entries[id] = old
	}
	content, err := json.Marshal(pkg)
	if err != nil {
		return err
	}
	var random [12]byte
	if _, err = rand.Read(random[:]); err != nil {
		return err
	}
	tmp := filepath.Join(id, ".bundle-"+hex.EncodeToString(random[:]))
	f, err := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer func() { _ = root.Remove(tmp) }()
	_, writeErr := f.Write(content)
	syncErr := f.Sync()
	closeErr := f.Close()
	if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
		return err
	}
	if err = root.Rename(tmp, filepath.Join(id, "bundle.json")); err != nil {
		return err
	}
	c.entries[id] = e
	c.paths[id] = id
	return nil
}
