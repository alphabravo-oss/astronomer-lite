// Package auth owns application identity. Kubernetes authorization continues
// to use each user's own cluster credentials; app admins gain no cluster role.
package auth

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/config"
	"golang.org/x/crypto/bcrypt"
)

const cookieName = "astronomer_lite_session"
const sessionLifetime = 8 * time.Hour

type session struct {
	UserID       string
	Expires      time.Time
	Context      context.Context
	cancel       context.CancelFunc
	passwordHash string
	authVersion  int
	oidcSession  *oidcSession
}
type attempt struct {
	Count int
	Until time.Time
}
type Manager struct {
	cfg            config.Config
	users          *userStore
	logger         *slog.Logger
	origin         string
	secure         bool
	mu             sync.Mutex
	sessions       map[[32]byte]*session
	attempts       map[string]attempt
	bcryptSlots    chan struct{}
	dummyHash      []byte
	oidc           *oidcClient
	mfaPending     map[string]mfaEnrollment
	trustedProxies []netip.Prefix
}
type contextKey struct{}
type sessionContextKey struct{}

// SessionContext survives an HTTP response and is cancelled on expiry/logout.
// Long-running server-managed sessions (such as port-forward) bind to it.
func SessionContext(ctx context.Context) context.Context {
	if session, ok := ctx.Value(sessionContextKey{}).(context.Context); ok {
		return session
	}
	return context.Background()
}

func CurrentUser(ctx context.Context) User { u, _ := ctx.Value(contextKey{}).(User); return u }

func New(cfg config.Config, logger *slog.Logger) (*Manager, error) {
	if cfg.AuthMode != "server" {
		return nil, fmt.Errorf("auth manager requires server mode")
	}
	public, err := url.Parse(cfg.PublicURL)
	if err != nil || public.Host == "" || public.User != nil || (public.Path != "" && public.Path != "/") || public.RawQuery != "" || public.Fragment != "" {
		return nil, errors.New("ASTRONOMER_LITE_PUBLIC_URL must be the root URL of this server")
	}
	local := public.Hostname() == "localhost" || public.Hostname() == "127.0.0.1" || public.Hostname() == "::1"
	if public.Scheme != "https" && (!local || public.Scheme != "http") {
		return nil, errors.New("server mode requires HTTPS, except on localhost")
	}
	users, err := openUsers(filepath.Join(cfg.ConfigDir, "users.json"))
	if err != nil {
		return nil, err
	}
	if len(users.list()) == 0 {
		if cfg.AdminPasswordFile == "" {
			return nil, errors.New("set ASTRONOMER_LITE_ADMIN_PASSWORD_FILE to bootstrap the first local administrator")
		}
		password, err := os.ReadFile(cfg.AdminPasswordFile)
		if err != nil {
			return nil, fmt.Errorf("read bootstrap password: %w", err)
		}
		if _, err = users.create(cfg.AdminUser, strings.TrimRight(string(password), "\r\n"), "admin"); err != nil {
			return nil, err
		}
	}
	dummy, err := bcrypt.GenerateFromPassword([]byte(randomToken()), 12)
	if err != nil {
		return nil, err
	}
	m := &Manager{cfg: cfg, users: users, logger: logger, origin: public.Scheme + "://" + public.Host, secure: public.Scheme == "https", sessions: map[[32]byte]*session{}, attempts: map[string]attempt{}, bcryptSlots: make(chan struct{}, 4), dummyHash: dummy}
	for _, value := range cfg.TrustedProxies {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(value))
		if err != nil {
			return nil, fmt.Errorf("invalid trusted proxy CIDR: %w", err)
		}
		m.trustedProxies = append(m.trustedProxies, prefix)
	}
	if err := m.validateProxy(); err != nil {
		return nil, err
	}
	if cfg.OIDCIssuer != "" || cfg.OIDCClientID != "" || cfg.OIDCSecretFile != "" {
		m.oidc, err = newOIDC(cfg, m.origin)
		if err != nil {
			return nil, err
		}
	}
	return m, nil
}
func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func failure(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		failure(w, 415, "JSON required")
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		failure(w, 400, "invalid request")
		return false
	}
	return true
}
func (m *Manager) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return r.Header.Get("X-Astronomer-Lite") == "1" && (origin == "" || origin == m.origin) && r.Header.Get("Sec-Fetch-Site") != "cross-site"
}
func (m *Manager) cookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: m.secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}
func (m *Manager) newSession(w http.ResponseWriter, user User, lifetime time.Duration, passwordHash string, authVersion ...int) *session {
	token := randomToken()
	key := sha256.Sum256([]byte(token))
	ctx, cancel := context.WithTimeout(context.Background(), lifetime)
	s := &session{UserID: user.ID, Expires: time.Now().Add(lifetime), Context: ctx, cancel: cancel, passwordHash: passwordHash}
	if len(authVersion) > 0 {
		s.authVersion = authVersion[0]
	}
	m.mu.Lock()
	// Bound memory and concurrent sessions per identity. Old sessions lose live streams too.
	count := 0
	var oldestKey [32]byte
	var oldest *session
	for k, existing := range m.sessions {
		if existing.UserID == user.ID {
			count++
			if oldest == nil || existing.Expires.Before(oldest.Expires) {
				oldestKey, oldest = k, existing
			}
		}
	}
	if count >= 10 {
		oldest.cancel()
		delete(m.sessions, oldestKey)
	}
	m.sessions[key] = s
	m.mu.Unlock()
	context.AfterFunc(ctx, func() { m.mu.Lock(); defer m.mu.Unlock(); delete(m.sessions, key) })
	m.cookie(w, cookieName, token, int(lifetime.Seconds()))
	return s
}
func (m *Manager) lookup(r *http.Request) (*session, User) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return nil, User{}
	}
	key := sha256.Sum256([]byte(c.Value))
	m.mu.Lock()
	s := m.sessions[key]
	var oidcState *oidcSession
	if s != nil {
		oidcState = s.oidcSession
	}
	m.mu.Unlock()
	if s == nil || !time.Now().Before(s.Expires) || s.Context.Err() != nil {
		return nil, User{}
	}
	a, ok := m.users.get(s.UserID)
	if !ok || a.Disabled || a.AuthVersion != s.authVersion || (s.passwordHash != "" && s.passwordHash != a.PasswordHash) {
		return nil, User{}
	}
	if a.Provider == "proxy" {
		u, err := m.proxyIdentity(r)
		if err != nil || u.ID != a.ID || s.Context.Err() != nil {
			s.cancel()
			return nil, User{}
		}
		a.User = u
	}
	if oidcState != nil {
		if !m.refreshOIDC(r.Context(), s, oidcState) {
			s.cancel()
			return nil, User{}
		}
		a, ok = m.users.get(s.UserID)
		if !ok || a.Disabled || s.Context.Err() != nil {
			return nil, User{}
		}
	}
	return s, a.User
}
func (m *Manager) revoke(userID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, s := range m.sessions {
		if s.UserID == userID {
			s.cancel()
			delete(m.sessions, key)
		}
	}
}

func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, s := range m.sessions {
		s.cancel()
		delete(m.sessions, key)
	}
}
func (m *Manager) limited(r *http.Request) bool {
	return m.limitedFor(r, r.URL.Path)
}
func (m *Manager) limitedFor(r *http.Request, principal string) bool {
	host := m.clientIP(r).String()
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for key, a := range m.attempts {
		if now.After(a.Until) {
			delete(m.attempts, key)
		}
	}
	if len(m.attempts) >= 10000 {
		return true
	}
	for _, bucket := range []struct {
		key   string
		limit int
	}{{host, 100}, {host + "/" + principal, 10}} {
		a := m.attempts[bucket.key]
		if a.Until.IsZero() {
			a.Until = now.Add(time.Minute)
		}
		if a.Count >= bucket.limit {
			return true
		}
		a.Count++
		m.attempts[bucket.key] = a
	}
	return false
}
func (m *Manager) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !decode(w, r, &body) {
		return
	}
	if m.limitedFor(r, "login:"+strings.ToLower(body.Username)) {
		w.Header().Set("Retry-After", "60")
		failure(w, 429, "too many sign-in attempts; try again in a minute")
		return
	}
	select {
	case m.bcryptSlots <- struct{}{}:
		defer func() { <-m.bcryptSlots }()
	default:
		failure(w, 429, "sign-in is busy; try again shortly")
		return
	}
	a, ok := m.users.get(userID("local", body.Username))
	hash := m.dummyHash
	if ok {
		hash = []byte(a.PasswordHash)
	}
	err := bcrypt.CompareHashAndPassword(hash, []byte(body.Password))
	if err != nil || !ok || a.Disabled {
		m.logger.Warn("sign-in rejected", "remote", r.RemoteAddr)
		failure(w, 401, "invalid username or password")
		return
	}
	if !m.users.checkSecondFactor(a, body.Code) {
		failure(w, 401, "valid authenticator or recovery code required")
		return
	}
	m.newSession(w, a.User, sessionLifetime, a.PasswordHash, a.AuthVersion)
	m.logger.Info("user signed in", "user", a.ID, "provider", "local")
	jsonResponse(w, 200, a.User)
}

// ServeAuth is mounted before the application gate; only explicitly public
// endpoints are allowed through without a session.
func (m *Manager) ServeAuth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != "GET" && !m.sameOrigin(r) {
		failure(w, 403, "same-origin request required")
		return
	}
	switch {
	case r.URL.Path == "/api/auth/session" && r.Method == "GET":
		_, u := m.lookup(r)
		var user any
		if u.ID != "" {
			user = u
		}
		jsonResponse(w, 200, map[string]any{"mode": "server", "user": user, "oidc": m.oidc != nil, "proxy": m.cfg.ProxyUserHeader != "", "plugins": m.cfg.PluginsEnabled})
	case r.URL.Path == "/api/auth/login" && r.Method == "POST":
		m.login(w, r)
	case r.URL.Path == "/api/auth/proxy" && r.Method == "POST":
		m.proxyLogin(w, r)
	case r.URL.Path == "/api/auth/oidc/login" && r.Method == "GET":
		m.oidcLogin(w, r)
	case r.URL.Path == "/api/auth/oidc/callback" && r.Method == "GET":
		m.oidcCallback(w, r)
	default:
		_, u := m.lookup(r)
		if u.ID == "" {
			failure(w, 401, "sign in required")
			return
		}
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/auth/mfa/") && r.Method == "POST":
			m.manageMFA(w, r, u)
		case r.URL.Path == "/api/auth/logout" && r.Method == "POST":
			c, _ := r.Cookie(cookieName)
			key := sha256.Sum256([]byte(c.Value))
			m.mu.Lock()
			if s := m.sessions[key]; s != nil {
				s.cancel()
				delete(m.sessions, key)
			}
			m.mu.Unlock()
			m.cookie(w, cookieName, "", -1)
			w.WriteHeader(204)
		case r.URL.Path == "/api/auth/password" && r.Method == "POST":
			var body struct {
				Current  string `json:"current"`
				Password string `json:"password"`
			}
			if !decode(w, r, &body) {
				return
			}
			if m.limited(r) {
				failure(w, 429, "too many attempts")
				return
			}
			a, _ := m.users.get(u.ID)
			if a.Provider != "local" || bcrypt.CompareHashAndPassword([]byte(a.PasswordHash), []byte(body.Current)) != nil {
				failure(w, 403, "current password is incorrect")
				return
			}
			updated, err := m.users.changePassword(u.ID, a.PasswordHash, body.Password)
			if err != nil {
				failure(w, 400, err.Error())
				return
			}
			m.revoke(u.ID)
			m.newSession(w, updated.User, sessionLifetime, updated.PasswordHash, updated.AuthVersion)
			w.WriteHeader(204)
		case r.URL.Path == "/api/auth/users" && u.Role == "admin":
			m.manageUsers(w, r, u)
		default:
			failure(w, 403, "action not permitted")
		}
	}
}
func (m *Manager) manageUsers(w http.ResponseWriter, r *http.Request, actor User) {
	if r.Method == "GET" {
		jsonResponse(w, 200, m.users.list())
		return
	}
	if r.Method != "POST" && r.Method != "PATCH" {
		failure(w, 405, "method not allowed")
		return
	}
	var body struct {
		ID       string `json:"id"`
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
		Disabled bool   `json:"disabled"`
	}
	if !decode(w, r, &body) {
		return
	}
	var u User
	var err error
	if r.Method == "POST" {
		if len(m.users.list()) >= 1000 {
			failure(w, 409, "account limit reached")
			return
		}
		u, err = m.users.create(body.Username, body.Password, body.Role)
	} else {
		u, err = m.users.update(body.ID, body.Role, body.Disabled, body.Password)
	}
	if err != nil {
		failure(w, 400, err.Error())
		return
	}
	if r.Method == "PATCH" {
		m.revoke(u.ID)
	}
	m.logger.Info("account changed", "actor", actor.ID, "user", u.ID, "action", r.Method)
	jsonResponse(w, 200, u)
}
func (m *Manager) Protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s, u := m.lookup(r)
		if s == nil {
			failure(w, 401, "sign in required")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && !m.sameOrigin(r) {
			failure(w, 403, "same-origin request required")
			return
		}
		if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") && r.Header.Get("Origin") != m.origin {
			failure(w, 403, "same-origin WebSocket required")
			return
		}
		base := context.WithValue(r.Context(), contextKey{}, u)
		base = context.WithValue(base, sessionContextKey{}, s.Context)
		ctx, cancel := context.WithCancel(base)
		defer cancel()
		stop := context.AfterFunc(s.Context, cancel)
		defer stop()
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(&sessionWriter{ResponseWriter: w, session: s}, r.WithContext(ctx))
	})
}

type sessionWriter struct {
	http.ResponseWriter
	session *session
}

func (w *sessionWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *sessionWriter) Flush()                      { _ = http.NewResponseController(w.ResponseWriter).Flush() }
func (w *sessionWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	c, b, err := http.NewResponseController(w.ResponseWriter).Hijack()
	if err != nil {
		return nil, nil, err
	}
	tracked := &sessionConn{Conn: c}
	tracked.stop = context.AfterFunc(w.session.Context, func() { _ = c.Close() })
	return tracked, b, nil
}

type sessionConn struct {
	net.Conn
	stop func() bool
}

func (c *sessionConn) Close() error {
	if c.stop != nil {
		c.stop()
	}
	return c.Conn.Close()
}
