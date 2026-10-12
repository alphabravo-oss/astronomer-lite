package forward

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestSeparateDomainRequired(t *testing.T) {
	for _, domain := range []string{"forward.lite.example.com", "example.com", "localhost", "*.forward.example.net", "127.0.0.1", "https://forward.example.net"} {
		if _, err := New(domain, "https://lite.example.com"); err == nil {
			t.Fatalf("accepted %q", domain)
		}
	}
	if _, err := New("forward.example.net", "http://lite.example.com"); err == nil {
		t.Fatal("accepted non-TLS deployment")
	}
}

func TestGatewayTicketIsolationHTTPAndRevocation(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.Header.Get("Cookie"), "astronomer") || r.Header.Get("X-Astronomer-Desktop") != "" || r.Header.Get("X-Astronomer-Lite") != "" {
			t.Error("host credentials reached upstream")
		}
		http.SetCookie(w, &http.Cookie{Name: "app", Value: "yes", Domain: "example.net", Path: "/"})
		http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "replace", Path: "/"})
		_, _ = w.Write([]byte(r.URL.RequestURI()))
	}))
	defer backend.Close()
	u, _ := url.Parse(backend.URL)
	_, p, _ := net.SplitHostPort(u.Host)
	port, _ := strconv.Atoi(p)
	g, err := New("forward.example.net", "https://lite.example.com")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	key, remove := g.Register(ctx, port)
	defer remove()
	link, err := g.Ticket(key)
	if err != nil {
		t.Fatal(err)
	}
	target, _ := url.Parse(link)
	call := func(path string, cookie *http.Cookie, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "https://"+target.Host+path, nil)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		r.AddCookie(&http.Cookie{Name: "astronomer_lite_session", Value: "must-not-forward"})
		r.Header.Set("X-Astronomer-Desktop", "must-not-forward")
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		g.ServeHTTP(w, r)
		return w
	}
	if call("/", nil, "").Code != 401 {
		t.Fatal("anonymous upstream access")
	}
	w := call(target.RequestURI(), nil, "")
	if w.Code != 200 || w.Body.String() != bootstrapHTML || w.Header().Get("Content-Security-Policy") == "" {
		t.Fatal(w.Code)
	}
	cookie := w.Result().Cookies()[0]
	if !cookie.Secure || !cookie.HttpOnly || cookie.Domain != "" || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("unsafe gateway cookie")
	}
	if call(target.RequestURI(), nil, "").Code != 401 {
		t.Fatal("ticket reused")
	}
	w = call("/path?q=1", cookie, "https://"+target.Host)
	if w.Code != 200 || w.Body.String() != "/path?q=1" {
		t.Fatal(w.Code, w.Body.String())
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "app" || cookies[0].Domain != "" {
		t.Fatal("upstream changed gateway or sibling cookies", cookies)
	}
	if call("/", cookie, "https://other.example.net").Code != 403 {
		t.Fatal("cross-origin request accepted")
	}
	cancel()
	if call("/", cookie, "").Code != 404 {
		t.Fatal("revoked forward retained access")
	}
}

func TestGatewayClosesActiveWebSocketOnSessionRevocation(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		for {
			kind, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if conn.WriteMessage(kind, data) != nil {
				return
			}
		}
	}))
	defer backend.Close()
	u, _ := url.Parse(backend.URL)
	_, p, _ := net.SplitHostPort(u.Host)
	port, _ := strconv.Atoi(p)
	g, _ := New("forward.example.net", "https://lite.example.com")
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	key, remove := g.Register(ctx, port)
	defer remove()
	link, _ := g.Ticket(key)
	target, _ := url.Parse(link)
	r := httptest.NewRequest("GET", link, nil)
	w := httptest.NewRecorder()
	g.ServeHTTP(w, r)
	cookie := w.Result().Cookies()[0]
	host := httptest.NewServer(g)
	defer host.Close()
	header := http.Header{"Host": []string{target.Host}, "Origin": []string{"https://" + target.Host}, "Cookie": []string{cookie.String()}}
	conn, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(host.URL, "http")+"/socket", header)
	if err != nil {
		if response != nil {
			body, _ := io.ReadAll(response.Body)
			t.Log(string(body))
		}
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	if err := conn.WriteMessage(websocket.TextMessage, []byte("hello")); err != nil {
		t.Fatal(err)
	}
	if _, data, err := conn.ReadMessage(); err != nil || string(data) != "hello" {
		t.Fatal("websocket not proxied", err)
	}
	cancel()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("revoked socket still open")
	} else if n, ok := err.(net.Error); ok && n.Timeout() {
		t.Fatal("revoked socket was not closed")
	}
}
