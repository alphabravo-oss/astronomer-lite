package auth

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

type oidcSession struct {
	mu      sync.Mutex
	token   *oauth2.Token
	expires time.Time
	subject string
	nonce   string
}

func (m *Manager) oidcIdentity(id *oidc.IDToken) (User, error) {
	var claims map[string]json.RawMessage
	if err := id.Claims(&claims); err != nil {
		return User{}, err
	}
	var name string
	_ = json.Unmarshal(claims["name"], &name)
	if name == "" {
		_ = json.Unmarshal(claims["preferred_username"], &name)
	}
	mapped := len(m.cfg.OIDCAdminGroups) > 0 || len(m.cfg.OIDCRequiredGroups) > 0
	groups := []string{}
	if mapped {
		claim := m.cfg.OIDCGroupsClaim
		if claim == "" {
			claim = "groups"
		}
		if err := json.Unmarshal(claims[claim], &groups); err != nil {
			return User{}, errors.New("required OIDC groups claim is missing or invalid")
		}
	}
	contains := func(allowed []string) bool {
		for _, group := range groups {
			for _, match := range allowed {
				if group == strings.TrimSpace(match) {
					return true
				}
			}
		}
		return false
	}
	if len(m.cfg.OIDCRequiredGroups) > 0 && !contains(m.cfg.OIDCRequiredGroups) {
		return User{}, errors.New("OIDC group membership does not permit sign-in")
	}
	user, err := m.users.oidcUser(m.oidc.issuer, id.Subject, name)
	if err != nil {
		return User{}, err
	}
	if len(m.cfg.OIDCAdminGroups) == 0 {
		return user, nil
	}
	role := "user"
	if contains(m.cfg.OIDCAdminGroups) {
		role = "admin"
	}
	m.users.mu.Lock()
	a := m.users.accounts[user.ID]
	changed := a.Role != role
	if changed {
		a.Role = role
		err = m.users.put(a)
	}
	m.users.mu.Unlock()
	if err != nil {
		return User{}, err
	}
	if changed {
		m.revoke(user.ID)
	}
	return a.User, nil
}

func (m *Manager) refreshOIDC(parent context.Context, s *session, state *oidcSession) bool {
	state.mu.Lock()
	defer state.mu.Unlock()
	if s.Context.Err() != nil {
		return false
	}
	if time.Until(state.expires) > 30*time.Second {
		return true
	}
	if state.token == nil || state.token.RefreshToken == "" {
		return time.Now().Before(state.expires)
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	stop := context.AfterFunc(s.Context, cancel)
	defer stop()
	expired := *state.token
	expired.Expiry = time.Now().Add(-time.Minute)
	token, err := m.oidc.oauth.TokenSource(ctx, &expired).Token()
	if err != nil {
		m.logger.Warn("OIDC refresh rejected by provider", "user", s.UserID)
		return false
	}
	raw, ok := token.Extra("id_token").(string)
	// Some providers omit ID tokens on refresh. Do not extend identity beyond
	// the verified ID token's lifetime when no fresh identity proof is provided.
	if !ok || raw == "" {
		m.logger.Warn("OIDC refresh omitted identity token", "user", s.UserID)
		return false
	}
	id, err := m.oidc.verifier.Verify(ctx, raw)
	if err != nil || id.Subject != state.subject || (id.Nonce != "" && id.Nonce != state.nonce) {
		m.logger.Warn("OIDC refreshed identity did not validate", "user", s.UserID)
		return false
	}
	user, err := m.oidcIdentity(id)
	if err != nil || user.ID != s.UserID || user.Disabled || s.Context.Err() != nil {
		return false
	}
	state.token, state.expires = token, id.Expiry
	return true
}

func (m *Manager) maintainOIDC(s *session, state *oidcSession) {
	for {
		state.mu.Lock()
		delay := max(time.Second, time.Until(state.expires)-30*time.Second)
		state.mu.Unlock()
		timer := time.NewTimer(delay)
		select {
		case <-s.Context.Done():
			timer.Stop()
			return
		case <-timer.C:
			if !m.refreshOIDC(s.Context, s, state) {
				s.cancel()
				return
			}
		}
	}
}
