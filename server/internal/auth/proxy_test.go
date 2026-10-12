package auth

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestProxyIdentityCannotBeForgedAndIsRechecked(t *testing.T) {
	m := testManager(t)
	m.cfg.ProxyUserHeader, m.cfg.ProxyGroupsHeader = "X-Auth-User", "X-Auth-Groups"
	m.cfg.ProxyAdminGroups, m.cfg.ProxyRequiredGroups = []string{"admins"}, []string{"users"}
	if m.validateProxy() == nil {
		t.Fatal("accepted identity proxy without trusted peers")
	}
	m.trustedProxies = []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}
	if err := m.validateProxy(); err != nil {
		t.Fatal(err)
	}
	call := func(peer, subject, groups string, cookie *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "https://lite.example/api/auth/proxy", nil)
		r.RemoteAddr = peer
		r.Header.Set("X-Astronomer-Lite", "1")
		r.Header.Set("Origin", "https://lite.example")
		r.Header.Set("X-Auth-User", subject)
		r.Header.Set("X-Auth-Groups", groups)
		w := httptest.NewRecorder()
		if cookie != nil {
			r.Method = "GET"
			r.URL.Path = "/api/clusters"
			r.AddCookie(cookie)
			m.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })).ServeHTTP(w, r)
		} else {
			m.ServeAuth(w, r)
		}
		return w
	}
	if w := call("192.0.2.1:123", "operator", "users,admins", nil); w.Code != 403 {
		t.Fatal("forged identity accepted", w.Code)
	}
	if w := call("10.0.0.1:123", "operator", "admins", nil); w.Code != 403 {
		t.Fatal("required group ignored", w.Code)
	}
	w := call("10.0.0.1:123", "operator", "users,admins", nil)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	cookie := w.Result().Cookies()[0]
	if call("10.0.0.1:123", "operator", "users,admins", cookie).Code != 204 {
		t.Fatal("proxy session rejected")
	}
	if call("10.0.0.1:123", "operator", "users", cookie).Code != 401 {
		t.Fatal("demotion did not revoke session")
	}
	u, _ := m.users.get(userID("proxy:"+m.origin, "operator"))
	if u.Role != "user" {
		t.Fatal("role not demoted")
	}
	w = call("10.0.0.1:123", "operator", "users", nil)
	cookie = w.Result().Cookies()[0]
	if call("10.0.0.1:123", "other", "users", cookie).Code != 401 {
		t.Fatal("identity substitution retained session")
	}
	w = call("10.0.0.1:123", "operator", "users", nil)
	cookie = w.Result().Cookies()[0]
	if call("192.0.2.1:123", "operator", "users", cookie).Code != 401 {
		t.Fatal("session bypassed proxy")
	}
}

func TestForwardedClientRequiresTrustedPeerAndChain(t *testing.T) {
	m := &Manager{trustedProxies: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}, attempts: map[string]attempt{}}
	for _, c := range []struct{ peer, header, want string }{
		{"192.0.2.1:123", "198.51.100.5", "192.0.2.1"},
		{"10.0.0.1:123", "198.51.100.5, 10.0.0.2", "198.51.100.5"},
		{"10.0.0.1:123", "spoofed, 192.0.2.1", "192.0.2.1"},
		{"10.0.0.1:123", "invalid", "10.0.0.1"},
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = c.peer
		r.Header.Set("X-Forwarded-For", c.header)
		if got := m.clientIP(r).String(); got != c.want {
			t.Errorf("got %s want %s", got, c.want)
		}
	}
	r := httptest.NewRequest("GET", "/", nil)
	for i := 0; i < 10; i++ {
		if m.limitedFor(r, "alice") {
			t.Fatal("limited early")
		}
	}
	if !m.limitedFor(r, "alice") {
		t.Fatal("missing identity limit")
	}
	if m.limitedFor(r, "bob") {
		t.Fatal("shared IP blocked another identity")
	}
	for i := 0; i < 100; i++ {
		m.limitedFor(r, fmt.Sprint(i))
	}
	if !m.limitedFor(r, "last") {
		t.Fatal("missing IP-wide limit")
	}
}
