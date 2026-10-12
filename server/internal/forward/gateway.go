// Package forward isolates forwarded applications on a separate wildcard domain.
// No Kubernetes or Lite login credential crosses into that browser origin.
package forward

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/publicsuffix"
)

const cookieName = "__Host-astronomer_forward"

type entry struct {
	ctx     context.Context
	host    string
	target  *url.URL
	cookie  [32]byte
	tickets map[[32]byte]time.Time
}
type Gateway struct {
	mu      sync.Mutex
	domain  string
	entries map[string]*entry
}

func New(domain, publicURL string) (*Gateway, error) {
	if domain == "" {
		return nil, nil
	}
	u, err := url.Parse(publicURL)
	if err != nil || u.Scheme != "https" {
		return nil, errors.New("browser forwarding requires an HTTPS public URL")
	}
	domain = strings.ToLower(strings.TrimSpace(domain))
	if strings.ContainsAny(domain, "/:* ") || net.ParseIP(domain) != nil {
		return nil, errors.New("forward domain must be a DNS suffix without a scheme, port or wildcard")
	}
	appSite, e1 := publicsuffix.EffectiveTLDPlusOne(u.Hostname())
	forwardSite, e2 := publicsuffix.EffectiveTLDPlusOne(domain)
	if e1 != nil || e2 != nil || appSite == forwardSite {
		return nil, errors.New("forwarding requires a separate registrable domain from Lite to isolate cookies and application content")
	}
	return &Gateway{domain: domain, entries: map[string]*entry{}}, nil
}
func random() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func (g *Gateway) Register(ctx context.Context, port int) (string, func()) {
	key := random()[:32]
	host := key + "." + g.domain
	target := &url.URL{Scheme: "http", Host: net.JoinHostPort("127.0.0.1", strconv.Itoa(port))}
	e := &entry{ctx: ctx, host: host, target: target, tickets: map[[32]byte]time.Time{}}
	g.mu.Lock()
	g.entries[key] = e
	g.mu.Unlock()
	remove := func() { g.mu.Lock(); delete(g.entries, key); g.mu.Unlock() }
	stop := context.AfterFunc(ctx, remove)
	return key, func() { stop(); remove() }
}
func (g *Gateway) Ticket(key string) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	e := g.entries[key]
	if e == nil || e.ctx.Err() != nil {
		return "", errors.New("forward has ended")
	}
	for k, expiry := range e.tickets {
		if time.Now().After(expiry) {
			delete(e.tickets, k)
		}
	}
	if len(e.tickets) >= 10 {
		return "", errors.New("too many pending browser links; retry in a minute")
	}
	ticket := random()
	e.tickets[sha256.Sum256([]byte(ticket))] = time.Now().Add(time.Minute)
	return "https://" + e.host + "/?lite_forward_ticket=" + ticket, nil
}
func (g *Gateway) Wrap(next http.Handler) http.Handler {
	if g == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := strings.ToLower(r.Host)
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if host == g.domain || strings.HasSuffix(host, "."+g.domain) {
			g.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

//go:embed bootstrap.html
var bootstrapHTML string

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
	host := strings.ToLower(r.Host)
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	key := strings.TrimSuffix(host, "."+g.domain)
	g.mu.Lock()
	e := g.entries[key]
	if e == nil || e.host != host || e.ctx.Err() != nil {
		g.mu.Unlock()
		http.Error(w, "forward not found", http.StatusNotFound)
		return
	}
	if ticket := r.URL.Query().Get("lite_forward_ticket"); ticket != "" {
		hash := sha256.Sum256([]byte(ticket))
		expiry, ok := e.tickets[hash]
		delete(e.tickets, hash)
		if !ok || time.Now().After(expiry) || r.Method != "GET" {
			g.mu.Unlock()
			http.Error(w, "browser link expired; open a new link from Lite", http.StatusUnauthorized)
			return
		}
		cookie := random()
		e.cookie = sha256.Sum256([]byte(cookie))
		g.mu.Unlock()
		http.SetCookie(w, &http.Cookie{Name: cookieName, Value: cookie, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode})
		// Commit a document on the forward origin before navigating. A server
		// redirect retains the cross-site context and withholds Strict cookies.
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
		_, _ = w.Write([]byte(bootstrapHTML))
		return
	}
	cookie, err := r.Cookie(cookieName)
	authorized := err == nil && e.cookie != [32]byte{} && sha256.Sum256([]byte(cookie.Value)) == e.cookie
	g.mu.Unlock()
	if !authorized {
		http.Error(w, "open this forward from your Lite workspace", http.StatusUnauthorized)
		return
	}
	// Reject cross-origin writes/WS handshakes; upstream apps remain responsible
	// for their own authorization, but cannot reuse Lite's browser session.
	if origin := r.Header.Get("Origin"); origin != "" && origin != "https://"+host {
		http.Error(w, "same-origin request required", http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stop := context.AfterFunc(e.ctx, cancel)
	defer stop()
	proxy := &httputil.ReverseProxy{Rewrite: func(p *httputil.ProxyRequest) {
		p.SetURL(e.target)
		p.Out.Host = host
		p.Out.Header.Del("Cookie")
		for _, c := range p.In.Cookies() {
			if c.Name != cookieName && !strings.HasPrefix(c.Name, "astronomer_lite") {
				p.Out.AddCookie(c)
			}
		}
		p.Out.Header.Del("X-Astronomer-Lite")
		p.Out.Header.Del("X-Astronomer-Desktop")
		p.Out.Header.Set("X-Forwarded-Proto", "https")
		p.Out.Header.Set("X-Forwarded-Host", host)
	}, ModifyResponse: func(response *http.Response) error {
		cookies := response.Cookies()
		response.Header.Del("Set-Cookie")
		for _, c := range cookies {
			if c.Name == cookieName || strings.HasPrefix(c.Name, "astronomer_lite") {
				continue
			}
			c.Domain = ""
			response.Header.Add("Set-Cookie", c.String())
		}
		response.Header.Set("Referrer-Policy", "no-referrer")
		return nil
	}, ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "forward unavailable", http.StatusBadGateway)
	}}
	proxy.ServeHTTP(w, r.WithContext(ctx))
}
