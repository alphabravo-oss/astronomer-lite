package plugins

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
)

type Permission struct {
	Group    string   `json:"group"`
	Resource string   `json:"resource"`
	Verbs    []string `json:"verbs"`
}
type Extension struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Version     string       `json:"version"`
	Description string       `json:"description"`
	Entry       string       `json:"entry"`
	Runtime     string       `json:"runtime,omitempty"`
	Permissions []Permission `json:"permissions"`
	Enabled     bool         `json:"enabled"`
	HTML        string       `json:"-"`
}
type Catalog struct {
	installMu  sync.Mutex
	dir        string
	paths      map[string]string
	catalogURL string
	trustKey   ed25519.PublicKey
	mu         sync.RWMutex
	entries    map[string]Extension
	stateFile  string
}

var identifier = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{0,62}$`)

// Packages are operator-installed directories containing a manifest and a
// self-contained HTML bundle. Their code never executes in the Go process.
func Load(dir, stateFile string) (*Catalog, error) {
	c := &Catalog{entries: map[string]Extension{}, paths: map[string]string{}, dir: dir, stateFile: stateFile}
	if dir == "" {
		return c, nil
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	defer func() { _ = root.Close() }()
	dirs, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	states := map[string]bool{}
	if data, err := os.ReadFile(stateFile); err == nil {
		if err = json.Unmarshal(data, &states); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	for _, d := range dirs {
		if !d.IsDir() || strings.HasPrefix(d.Name(), ".") {
			continue
		}
		if len(c.entries) >= 64 {
			return nil, errors.New("at most 64 external plugins may be installed")
		}
		var e Extension
		bundle, bundleErr := root.Open(filepath.Join(d.Name(), "bundle.json"))
		if bundleErr == nil {
			var pkg Package
			data, readErr := io.ReadAll(io.LimitReader(bundle, (8<<20)+1))
			_ = bundle.Close()
			if readErr != nil || len(data) > 8<<20 || json.Unmarshal(data, &pkg) != nil {
				return nil, fmt.Errorf("invalid installed package %s", d.Name())
			}
			e = pkg.Manifest
			e.HTML = pkg.HTML
		} else if errors.Is(bundleErr, os.ErrNotExist) {
			manifest, err := root.Open(filepath.Join(d.Name(), "plugin.json"))
			if err != nil {
				return nil, err
			}
			dec := json.NewDecoder(io.LimitReader(manifest, 64<<10))
			dec.DisallowUnknownFields()
			err = dec.Decode(&e)
			_ = manifest.Close()
			if err != nil {
				return nil, fmt.Errorf("plugin %s: %w", d.Name(), err)
			}
			if e.Entry != "index.html" {
				return nil, errors.New("plugin entry must be index.html")
			}
			f, err := root.Open(filepath.Join(d.Name(), e.Entry))
			if err != nil {
				return nil, err
			}
			html, err := io.ReadAll(io.LimitReader(f, (2<<20)+1))
			_ = f.Close()
			if err != nil {
				return nil, err
			}
			e.HTML = string(html)
		} else {
			return nil, bundleErr
		}
		if err := validateExtension(e); err != nil {
			return nil, err
		}
		if len(e.HTML) > 2<<20 {
			return nil, errors.New("plugin bundle exceeds 2 MiB")
		}
		if _, exists := c.entries[e.ID]; exists {
			return nil, fmt.Errorf("duplicate plugin ID %s", e.ID)
		}
		c.paths[e.ID] = d.Name()
		e.Enabled = states[e.ID]
		c.entries[e.ID] = e
	}
	return c, nil
}
func (c *Catalog) List() []Extension {
	c.mu.RLock()
	defer c.mu.RUnlock()
	list := make([]Extension, 0, len(c.entries))
	for _, e := range c.entries {
		list = append(list, e)
	}
	slices.SortFunc(list, func(a, b Extension) int {
		if a.Name < b.Name {
			return -1
		}
		if a.Name > b.Name {
			return 1
		}
		return 0
	})
	return list
}
func (c *Catalog) Get(id string) (Extension, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[id]
	return e, ok
}
func (c *Catalog) SetEnabled(id string, enabled bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[id]
	if !ok {
		return os.ErrNotExist
	}
	states := map[string]bool{}
	for id, e := range c.entries {
		states[id] = e.Enabled
	}
	states[id] = enabled
	if err := c.writeStates(states); err != nil {
		return err
	}
	e.Enabled = enabled
	c.entries[id] = e
	return nil
}
func (c *Catalog) writeStates(states map[string]bool) error {
	data, err := json.MarshalIndent(states, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(c.stateFile), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(c.stateFile), ".plugins-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(f.Name()) }()
	if _, err = f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), c.stateFile); err != nil {
		return err
	}
	return nil
}
func validateExtension(e Extension) error {
	if e.Runtime != "" && e.Runtime != "headlamp-v1" {
		return fmt.Errorf("unsupported runtime %s", e.Runtime)
	}
	if !identifier.MatchString(e.ID) || e.Name == "" || len(e.Name) > 80 || e.Version == "" || e.Entry != "index.html" || len(e.Permissions) > 32 {
		return fmt.Errorf("invalid manifest for plugin %s", e.ID)
	}
	for _, p := range e.Permissions {
		if !identifier.MatchString(p.Resource) || len(p.Verbs) == 0 {
			return fmt.Errorf("invalid permission in %s", e.ID)
		}
		for _, v := range p.Verbs {
			if !slices.Contains([]string{"get", "list", "apply", "delete"}, v) {
				return fmt.Errorf("unsupported plugin verb %s", v)
			}
		}
	}
	return nil
}
func (e Extension) Allows(group, resource, verb string) bool {
	for _, p := range e.Permissions {
		if p.Group == group && p.Resource == resource && slices.Contains(p.Verbs, verb) {
			return true
		}
	}
	return false
}
