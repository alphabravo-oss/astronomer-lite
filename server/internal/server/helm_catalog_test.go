package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/alphabravo/astronomer-lite/server/internal/config"
)

func TestHelmCatalogPinsVersionAndVerifiesArchive(t *testing.T) {
	archive := []byte("test archive bytes")
	digest := sha256.Sum256(archive)
	var corrupt atomic.Bool
	repository := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/index.yaml":
			_, _ = fmt.Fprintf(w, "apiVersion: v1\nentries:\n  tiny:\n  - name: tiny\n    version: 1.0.0\n    apiVersion: v2\n    urls: [tiny.tgz]\n    digest: %s\n", hex.EncodeToString(digest[:]))
		case "/tiny.tgz":
			if corrupt.Load() {
				_, _ = w.Write([]byte("changed"))
			} else {
				_, _ = w.Write(archive)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer repository.Close()
	s := &Server{Config: config.Config{HelmRepositories: []string{repository.URL}}}
	id := s.chartRepositories()[0].ID
	got, err := s.downloadChart(context.Background(), id, "tiny", "1.0.0")
	if err != nil || string(got) != string(archive) {
		t.Fatalf("download: %q %v", got, err)
	}
	for _, tc := range []struct{ repository, version string }{{repository.URL, "1.0.0"}, {id, ""}, {id, "2.0.0"}} {
		if _, err := s.downloadChart(context.Background(), tc.repository, "tiny", tc.version); err == nil {
			t.Fatal("accepted unknown repository or unpinned/missing version", tc)
		}
	}
	corrupt.Store(true)
	if _, err := s.downloadChart(context.Background(), id, "tiny", "1.0.0"); err == nil {
		t.Fatal("accepted changed chart digest")
	}
	if _, err := fetchChartFile(context.Background(), repository.URL+"/tiny.tgz", 2); err == nil {
		t.Fatal("download limit not enforced")
	}
	if _, err := fetchChartFile(context.Background(), "file:///etc/passwd", 100); err == nil {
		t.Fatal("accepted non-HTTP chart")
	}
}
