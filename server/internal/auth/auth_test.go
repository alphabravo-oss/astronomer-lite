package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/config"
	"github.com/gorilla/websocket"
)

const testPassword = "test-only-password-1234"

func testManager(t *testing.T) *Manager {
	t.Helper()
	dir := t.TempDir()
	secret := filepath.Join(dir, "password")
	if err := os.WriteFile(secret, []byte(testPassword), 0600); err != nil {
		t.Fatal(err)
	}
	m, err := New(config.Config{AuthMode: "server", ConfigDir: dir, PublicURL: "https://lite.example", AdminUser: "admin", AdminPasswordFile: secret}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, u := range m.users.list() {
			m.revoke(u.ID)
		}
	})
	return m
}
func authCall(m *Manager, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	r := httptest.NewRequest(method, "https://lite.example/api/auth/"+path, bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Astronomer-Lite", "1")
	r.Header.Set("Origin", "https://lite.example")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	m.ServeAuth(w, r)
	return w
}
func loginCookie(t *testing.T, m *Manager, username, password string) *http.Cookie {
	t.Helper()
	w := authCall(m, "POST", "login", map[string]string{"username": username, "password": password}, nil)
	if w.Code != 200 {
		t.Fatalf("login: %d %s", w.Code, w.Body.String())
	}
	return w.Result().Cookies()[0]
}
func protectedStatus(m *Manager, c *http.Cookie) int {
	r := httptest.NewRequest("GET", "https://lite.example/api/clusters", nil)
	if c != nil {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	m.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if CurrentUser(r.Context()).ID == "" {
			panic("missing identity")
		}
		w.WriteHeader(204)
	})).ServeHTTP(w, r)
	return w.Code
}

func TestLocalSessionsAndAccountAdministration(t *testing.T) {
	m := testManager(t)
	if got := protectedStatus(m, nil); got != 401 {
		t.Fatalf("anonymous status %d", got)
	}
	w := authCall(m, "POST", "login", map[string]string{"username": "admin", "password": "wrong"}, nil)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
	admin := loginCookie(t, m, "admin", testPassword)
	if !admin.HttpOnly || !admin.Secure || admin.SameSite != http.SameSiteLaxMode {
		t.Fatal("session cookie not hardened")
	}
	if got := protectedStatus(m, admin); got != 204 {
		t.Fatal(got)
	}
	w = authCall(m, "POST", "users", map[string]string{"username": "alice", "password": testPassword, "role": "user"}, admin)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var alice User
	_ = json.Unmarshal(w.Body.Bytes(), &alice)
	cookie := loginCookie(t, m, "alice", testPassword)
	if w = authCall(m, "GET", "users", nil, cookie); w.Code != 403 {
		t.Fatal("non-admin accessed accounts")
	}
	if w = authCall(m, "PATCH", "users", map[string]any{"id": userID("local", "admin"), "role": "user"}, admin); w.Code != 400 {
		t.Fatal("demoted last admin")
	}
	if w = authCall(m, "PATCH", "users", map[string]any{"id": alice.ID, "role": "user", "password": "replacement-password-123"}, admin); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if protectedStatus(m, cookie) != 401 {
		t.Fatal("password reset retained old session")
	}
	cookie = loginCookie(t, m, "alice", "replacement-password-123")
	if w = authCall(m, "POST", "logout", map[string]any{}, cookie); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	if protectedStatus(m, cookie) != 401 {
		t.Fatal("logout did not revoke session")
	}
	saved, err := os.ReadFile(m.users.path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(saved), testPassword) {
		t.Fatal("plaintext password persisted")
	}
	info, _ := os.Stat(m.users.path)
	if info.Mode().Perm() != 0600 {
		t.Fatal(info.Mode())
	}
	reopened, err := openUsers(m.users.path)
	if err != nil || len(reopened.list()) != 2 {
		t.Fatal("accounts not persistent", err)
	}
}
func TestOriginAndRevocation(t *testing.T) {
	m := testManager(t)
	cookie := loginCookie(t, m, "admin", testPassword)
	r := httptest.NewRequest("POST", "https://lite.example/api/auth/logout", strings.NewReader("{}"))
	r.AddCookie(cookie)
	r.Header.Set("Origin", "https://attacker.example")
	r.Header.Set("X-Astronomer-Lite", "1")
	w := httptest.NewRecorder()
	m.ServeAuth(w, r)
	if w.Code != 403 {
		t.Fatal("cross-site mutation accepted")
	}
	r = httptest.NewRequest("POST", "https://lite.example/api/clusters", nil)
	r.AddCookie(cookie)
	w = httptest.NewRecorder()
	m.Protect(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("mutation without CSRF header reached handler") })).ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
	r = httptest.NewRequest("GET", "https://lite.example/api/ws", nil)
	r.AddCookie(cookie)
	r.Header.Set("Upgrade", "websocket")
	r.Header.Set("Origin", "https://attacker.example")
	w = httptest.NewRecorder()
	m.Protect(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("cross-site socket reached handler") })).ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
	started := make(chan context.Context, 1)
	server := httptest.NewServer(m.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { started <- r.Context(); <-r.Context().Done() })))
	defer server.Close()
	req, _ := http.NewRequest("GET", server.URL, nil)
	req.AddCookie(cookie)
	done := make(chan struct{})
	go func() {
		response, err := http.DefaultClient.Do(req)
		if err == nil {
			_ = response.Body.Close()
		}
		close(done)
	}()
	ctx := <-started
	m.revoke(userID("local", "admin"))
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("request survived revocation")
	}
	<-done
}
func TestWebSocketClosesOnLogout(t *testing.T) {
	m := testManager(t)
	cookie := loginCookie(t, m, "admin", testPassword)
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(m.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.Close() }()
		_, _, _ = c.ReadMessage()
	})))
	defer server.Close()
	header := http.Header{"Cookie": {cookie.Name + "=" + cookie.Value}, "Origin": {"https://lite.example"}}
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), header)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	m.revoke(userID("local", "admin"))
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err = conn.ReadMessage(); err == nil {
		t.Fatal("socket survived logout")
	}
}
func TestLoginRateLimitAndExpiry(t *testing.T) {
	m := testManager(t)
	req := httptest.NewRequest("POST", "http://example", nil)
	for i := 0; i < 10; i++ {
		if m.limited(req) {
			t.Fatal("limited too early")
		}
	}
	if !m.limited(req) {
		t.Fatal("not rate limited")
	}
	a, _ := m.users.get(userID("local", "admin"))
	w := httptest.NewRecorder()
	m.newSession(w, a.User, 20*time.Millisecond, a.PasswordHash)
	cookie := w.Result().Cookies()[0]
	time.Sleep(30 * time.Millisecond)
	if protectedStatus(m, cookie) != 401 {
		t.Fatal("expired session accepted")
	}
}
