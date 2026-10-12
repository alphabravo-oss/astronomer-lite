package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/config"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

type oidcFlow struct {
	Verifier string
	Nonce    string
	Expires  time.Time
}
type oidcClient struct {
	oauth    oauth2.Config
	verifier *oidc.IDTokenVerifier
	issuer   string
	initMu   sync.Mutex
	mu       sync.Mutex
	flows    map[[32]byte]oidcFlow
}

func newOIDC(cfg config.Config, origin string) (*oidcClient, error) {
	issuer, err := url.Parse(cfg.OIDCIssuer)
	if err != nil || issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" || cfg.OIDCClientID == "" {
		return nil, errors.New("OIDC requires a valid issuer URL and client ID")
	}
	local := issuer.Hostname() == "localhost" || issuer.Hostname() == "127.0.0.1" || issuer.Hostname() == "::1"
	if issuer.Scheme != "https" && (issuer.Scheme != "http" || !local) {
		return nil, errors.New("OIDC issuer requires HTTPS except on localhost")
	}
	var secret string
	if cfg.OIDCSecretFile != "" {
		b, err := os.ReadFile(cfg.OIDCSecretFile)
		if err != nil {
			return nil, err
		}
		secret = strings.TrimRight(string(b), "\r\n")
	}
	scopes := []string{oidc.ScopeOpenID, "profile", "email"}
	if cfg.OIDCRefresh {
		scopes = append(scopes, "offline_access")
	}
	if len(cfg.OIDCAdminGroups) > 0 || len(cfg.OIDCRequiredGroups) > 0 {
		scopes = append(scopes, "groups")
	}
	return &oidcClient{oauth: oauth2.Config{ClientID: cfg.OIDCClientID, ClientSecret: secret, RedirectURL: origin + "/api/auth/oidc/callback", Scopes: scopes}, issuer: cfg.OIDCIssuer, flows: map[[32]byte]oidcFlow{}}, nil
}

// Discover on the first SSO attempt so an identity-provider outage never
// prevents the application from starting or accepting local sign-ins.
func (o *oidcClient) ensureProvider(parent context.Context) error {
	o.initMu.Lock()
	defer o.initMu.Unlock()
	if o.verifier != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	provider, err := oidc.NewProvider(ctx, o.issuer)
	if err != nil {
		return err
	}
	o.oauth.Endpoint = provider.Endpoint()
	o.verifier = provider.Verifier(&oidc.Config{ClientID: o.oauth.ClientID})
	return nil
}
func (m *Manager) oidcLogin(w http.ResponseWriter, r *http.Request) {
	if m.oidc == nil {
		failure(w, 404, "SSO is not configured")
		return
	}
	if m.limited(r) {
		failure(w, 429, "too many sign-in attempts")
		return
	}
	if err := m.oidc.ensureProvider(r.Context()); err != nil {
		m.logger.Warn("SSO discovery unavailable")
		http.Redirect(w, r, "/?authError=sso", http.StatusSeeOther)
		return
	}
	state := randomToken()
	flow := oidcFlow{Verifier: oauth2.GenerateVerifier(), Nonce: randomToken(), Expires: time.Now().Add(5 * time.Minute)}
	m.oidc.mu.Lock()
	for k, f := range m.oidc.flows {
		if time.Now().After(f.Expires) {
			delete(m.oidc.flows, k)
		}
	}
	if len(m.oidc.flows) >= 1000 {
		m.oidc.mu.Unlock()
		failure(w, 429, "SSO is busy")
		return
	}
	m.oidc.flows[sha256.Sum256([]byte(state))] = flow
	m.oidc.mu.Unlock()
	m.cookie(w, "astronomer_lite_oidc", state, 300)
	http.Redirect(w, r, m.oidc.oauth.AuthCodeURL(state, oauth2.S256ChallengeOption(flow.Verifier), oidc.Nonce(flow.Nonce)), http.StatusFound)
}
func (m *Manager) oidcCallback(w http.ResponseWriter, r *http.Request) {
	failed := func() { http.Redirect(w, r, "/?authError=sso", http.StatusSeeOther) }
	if m.oidc == nil {
		failure(w, 404, "SSO is not configured")
		return
	}
	cookie, err := r.Cookie("astronomer_lite_oidc")
	state := r.URL.Query().Get("state")
	if err != nil || state == "" || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(state)) != 1 {
		failed()
		return
	}
	m.cookie(w, "astronomer_lite_oidc", "", -1)
	key := sha256.Sum256([]byte(state))
	m.oidc.mu.Lock()
	flow, ok := m.oidc.flows[key]
	delete(m.oidc.flows, key)
	m.oidc.mu.Unlock()
	if !ok || time.Now().After(flow.Expires) || r.URL.Query().Get("error") != "" {
		failed()
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	token, err := m.oidc.oauth.Exchange(ctx, r.URL.Query().Get("code"), oauth2.VerifierOption(flow.Verifier))
	if err != nil {
		failed()
		return
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok {
		failed()
		return
	}
	id, err := m.oidc.verifier.Verify(ctx, raw)
	if err != nil || subtle.ConstantTimeCompare([]byte(id.Nonce), []byte(flow.Nonce)) != 1 {
		failed()
		return
	}
	user, err := m.oidcIdentity(id)
	if err != nil {
		failed()
		return
	}
	lifetime := min(sessionLifetime, time.Until(id.Expiry))
	if lifetime <= 0 {
		failed()
		return
	}
	refresh := m.cfg.OIDCRefresh && token.RefreshToken != ""
	if refresh {
		lifetime = sessionLifetime
	}
	s := m.newSession(w, user, lifetime, "")
	if refresh {
		state := &oidcSession{token: token, expires: id.Expiry, subject: id.Subject, nonce: flow.Nonce}
		m.mu.Lock()
		s.oidcSession = state
		m.mu.Unlock()
		go m.maintainOIDC(s, state)
	}
	m.logger.Info("user signed in", "user", user.ID, "provider", "oidc")
	http.Redirect(w, r, "/", http.StatusSeeOther)
}
