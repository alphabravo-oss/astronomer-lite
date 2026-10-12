package plugins

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
)

func TestSignedCatalogInstallUpdateAndTampering(t *testing.T) {
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signed := func(value any) []byte {
		payload, _ := json.Marshal(value)
		out, _ := json.Marshal(SignedEnvelope{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))})
		return out
	}
	var content atomic.Value
	content.Store(map[string][]byte{})
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, ok := content.Load().(map[string][]byte)[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(data)
	}))
	defer host.Close()
	root := t.TempDir()
	keyFile := filepath.Join(t.TempDir(), "key")
	if err = os.WriteFile(keyFile, []byte(base64.StdEncoding.EncodeToString(pub)), 0600); err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(t.TempDir(), "state.json")
	catalog, err := Load(root, state)
	if err != nil {
		t.Fatal(err)
	}
	if err = catalog.ConfigureDistribution(host.URL+"/index", keyFile); err != nil {
		t.Fatal(err)
	}
	makePackage := func(version, resource string) (Package, []byte, PackageListing) {
		pkg := Package{Manifest: Extension{ID: "sample", Name: "Sample", Version: version, Entry: "index.html", Permissions: []Permission{{Resource: resource, Verbs: []string{"list"}}}}, HTML: "<h1>" + version + "</h1>"}
		data := signed(pkg)
		sum := sha256.Sum256(data)
		return pkg, data, PackageListing{Manifest: pkg.Manifest, URL: host.URL + "/package", SHA256: hex.EncodeToString(sum[:])}
	}
	pkg, data, listing := makePackage("1.0.0", "namespaces")
	publish := func(data []byte, listing PackageListing) {
		content.Store(map[string][]byte{"/index": signed(PackageIndex{Version: 1, Packages: []PackageListing{listing}}), "/package": data})
	}
	publish(data, listing)
	if err = catalog.Install(t.Context(), "sample", "1.0.0", listing.SHA256); err != nil {
		t.Fatal(err)
	}
	e, _ := catalog.Get("sample")
	if e.Enabled || e.HTML != pkg.HTML {
		t.Fatal("new package was enabled or corrupted")
	}
	if err = catalog.SetEnabled("sample", true); err != nil {
		t.Fatal(err)
	}
	_, next, nextListing := makePackage("1.1.0", "pods")
	publish(append(append([]byte{}, next...), byte('x')), nextListing)
	if catalog.Install(t.Context(), "sample", "1.1.0", nextListing.SHA256) == nil {
		t.Fatal("tampered package accepted")
	}
	publish(next, nextListing)
	if err = catalog.Install(t.Context(), "sample", "1.1.0", nextListing.SHA256); err != nil {
		t.Fatal(err)
	}
	e, _ = catalog.Get("sample")
	if e.Enabled || e.Version != "1.1.0" {
		t.Fatal("update did not require re-enable")
	}
	reopened, err := Load(root, state)
	if err != nil {
		t.Fatal(err)
	}
	e, _ = reopened.Get("sample")
	if e.Version != "1.1.0" || e.Enabled {
		t.Fatal("update not persisted")
	}
	publish(data, listing)
	if catalog.Install(t.Context(), "sample", "1.0.0", listing.SHA256) == nil {
		t.Fatal("downgrade accepted")
	}
	wrongPub, _, _ := ed25519.GenerateKey(rand.Reader)
	catalog.trustKey = wrongPub
	if _, err = catalog.Available(t.Context()); err == nil {
		t.Fatal("untrusted catalog accepted")
	}
}
