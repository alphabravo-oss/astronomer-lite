package desktop

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPrivateListener(t *testing.T) {
	token := strings.Repeat("a", 64)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Astronomer-Desktop") != "" {
			t.Fatal("capability reached application")
		}
		w.WriteHeader(204)
	})
	for _, host := range []string{"", "0.0.0.0", "example.com"} {
		if _, err := Guard(next, token, host); err == nil {
			t.Fatalf("accepted %q", host)
		}
	}
	h, err := Guard(next, token, "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"", "wrong", token} {
		r := httptest.NewRequest("GET", "/api/clusters", nil)
		r.Header.Set("X-Astronomer-Desktop", value)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := 401
		if value == token {
			want = 204
		}
		if w.Code != want {
			t.Fatalf("got %d want %d", w.Code, want)
		}
	}
}
