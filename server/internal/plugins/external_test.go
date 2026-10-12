package plugins

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExternalPluginLoadEnableAndPermissions(t *testing.T) {
	dir := t.TempDir()
	pluginDir := filepath.Join(dir, "example")
	_ = os.Mkdir(pluginDir, 0700)
	manifest := `{"id":"example","name":"Example","version":"1.0","entry":"index.html","permissions":[{"group":"","resource":"namespaces","verbs":["list"]}]}`
	_ = os.WriteFile(filepath.Join(pluginDir, "plugin.json"), []byte(manifest), 0600)
	_ = os.WriteFile(filepath.Join(pluginDir, "index.html"), []byte("<h1>Plugin</h1>"), 0600)
	state := filepath.Join(t.TempDir(), "state.json")
	c, err := Load(dir, state)
	if err != nil {
		t.Fatal(err)
	}
	e, ok := c.Get("example")
	if !ok || e.Enabled || e.HTML == "" {
		t.Fatal(e)
	}
	if !e.Allows("", "namespaces", "list") || e.Allows("", "secrets", "list") || e.Allows("", "namespaces", "delete") {
		t.Fatal("permission scope broken")
	}
	if err = c.SetEnabled("example", true); err != nil {
		t.Fatal(err)
	}
	c, err = Load(dir, state)
	if err != nil {
		t.Fatal(err)
	}
	e, _ = c.Get("example")
	if !e.Enabled {
		t.Fatal("enable did not persist")
	}
	if err = c.SetEnabled("example", false); err != nil {
		t.Fatal(err)
	}
	e, _ = c.Get("example")
	if e.Enabled {
		t.Fatal("disable failed")
	}
	// A package cannot escape the installation directory through its bundle.
	outside := filepath.Join(t.TempDir(), "secret.html")
	_ = os.WriteFile(outside, []byte("private"), 0600)
	_ = os.Remove(filepath.Join(pluginDir, "index.html"))
	_ = os.Symlink(outside, filepath.Join(pluginDir, "index.html"))
	if _, err = Load(dir, state); err == nil {
		t.Fatal("accepted escaping bundle symlink")
	}
}
