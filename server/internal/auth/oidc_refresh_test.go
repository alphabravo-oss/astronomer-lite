package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/config"
	jose "github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"golang.org/x/oauth2"
)

func TestOIDCRefreshRotatesTokensAndRejectsChangedIdentity(t *testing.T) {
	for _, scenario := range []string{"rotation", "subject", "audience", "missing", "groups"} {
		t.Run(scenario, func(t *testing.T) {
			m := testManager(t)
			key, err := rsa.GenerateKey(rand.Reader, 2048)
			if err != nil {
				t.Fatal(err)
			}
			signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithHeader("kid", "test"))
			if err != nil {
				t.Fatal(err)
			}
			var issuer string
			var calls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/.well-known/openid-configuration":
					_ = json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token", "jwks_uri": issuer + "/keys", "id_token_signing_alg_values_supported": []string{"RS256"}})
				case "/keys":
					_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "test", Algorithm: "RS256", Use: "sig"}}})
				case "/token":
					_ = r.ParseForm()
					if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "first" {
						http.Error(w, "bad refresh", 400)
						return
					}
					calls.Add(1)
					subject, audience := "stable-subject", "lite-test"
					groups := []string{"operators"}
					if scenario == "subject" {
						subject = "different-subject"
					}
					if scenario == "audience" {
						audience = "different-client"
					}
					if scenario == "groups" {
						groups = []string{}
					}
					raw, signErr := jwt.Signed(signer).Claims(jwt.Claims{Issuer: issuer, Subject: subject, Audience: jwt.Audience{audience}, Expiry: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now())}).Claims(map[string]any{"groups": groups}).Serialize()
					if signErr != nil {
						t.Error(signErr)
						http.Error(w, "sign", 500)
						return
					}
					response := map[string]any{"access_token": "access", "token_type": "Bearer", "refresh_token": "rotated", "expires_in": 3600}
					if scenario != "missing" {
						response["id_token"] = raw
					}
					_ = json.NewEncoder(w).Encode(response)
				default:
					http.NotFound(w, r)
				}
			}))
			defer provider.Close()
			issuer = provider.URL
			cfg := config.Config{OIDCIssuer: issuer, OIDCClientID: "lite-test", OIDCRefresh: true, OIDCAdminGroups: []string{"operators"}, OIDCGroupsClaim: "groups"}
			m.cfg.OIDCRefresh, m.cfg.OIDCAdminGroups, m.cfg.OIDCGroupsClaim = true, cfg.OIDCAdminGroups, cfg.OIDCGroupsClaim
			m.oidc, err = newOIDC(cfg, m.origin)
			if err != nil {
				t.Fatal(err)
			}
			if err := m.oidc.ensureProvider(t.Context()); err != nil {
				t.Fatal(err)
			}
			initial, err := jwt.Signed(signer).Claims(jwt.Claims{Issuer: issuer, Subject: "stable-subject", Audience: jwt.Audience{"lite-test"}, Expiry: jwt.NewNumericDate(time.Now().Add(time.Hour))}).Claims(map[string]any{"groups": []string{"operators"}}).Serialize()
			if err != nil {
				t.Fatal(err)
			}
			id, err := m.oidc.verifier.Verify(t.Context(), initial)
			if err != nil {
				t.Fatal(err)
			}
			user, err := m.oidcIdentity(id)
			if err != nil || user.Role != "admin" {
				t.Fatal("group mapping", user, err)
			}
			recorder := httptest.NewRecorder()
			s := m.newSession(recorder, user, sessionLifetime, "")
			state := &oidcSession{token: &oauth2.Token{RefreshToken: "first", Expiry: time.Now().Add(-time.Minute)}, expires: time.Now().Add(-time.Second), subject: "stable-subject", nonce: "original"}
			m.mu.Lock()
			s.oidcSession = state
			m.mu.Unlock()
			status := protectedStatus(m, recorder.Result().Cookies()[0])
			if calls.Load() != 1 {
				t.Fatal("refresh was not requested")
			}
			if scenario == "rotation" {
				if status != 204 || state.token.RefreshToken != "rotated" {
					t.Fatal("refresh did not rotate or preserve session", status)
				}
				if protectedStatus(m, recorder.Result().Cookies()[0]) != 204 || calls.Load() != 1 {
					t.Fatal("valid token refreshed again")
				}
			} else {
				if status != 401 || s.Context.Err() == nil {
					t.Fatal("invalid identity retained session", status)
				}
				if scenario == "groups" {
					current, _ := m.users.get(user.ID)
					if current.Role != "user" {
						t.Fatal("group removal did not demote")
					}
				}
			}
		})
	}
}
