package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/config"
	jose "github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

func TestOIDCCodeFlowValidation(t *testing.T) {
	m := testManager(t)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "test"))
	if err != nil {
		t.Fatal(err)
	}
	var issuer, nonce, challenge string
	audience := "lite-test"
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token", "jwks_uri": issuer + "/keys", "response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/keys":
			_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "test", Algorithm: "RS256", Use: "sig"}}})
		case "/token":
			_ = r.ParseForm()
			sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if base64.RawURLEncoding.EncodeToString(sum[:]) != challenge {
				http.Error(w, "bad PKCE", 400)
				return
			}
			encoded, err := jwt.Signed(signer).Claims(jwt.Claims{Issuer: issuer, Subject: "oidc-subject", Audience: jwt.Audience{audience}, Expiry: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now())}).Claims(map[string]any{"nonce": nonce, "name": "SSO User"}).Serialize()
			if err != nil {
				t.Error(err)
				http.Error(w, "sign", 500)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "unused", "token_type": "Bearer", "id_token": encoded, "expires_in": 3600})
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	issuer = provider.URL
	m.oidc, err = newOIDC(config.Config{OIDCIssuer: issuer, OIDCClientID: "lite-test"}, m.origin)
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"valid", "bad nonce", "bad audience", "bad state"} {
		t.Run(scenario, func(t *testing.T) {
			start := authCall(m, "GET", "oidc/login", nil, nil)
			if start.Code != 302 {
				t.Fatal(start.Body.String())
			}
			location, _ := url.Parse(start.Header().Get("Location"))
			query := location.Query()
			state := query.Get("state")
			nonce = query.Get("nonce")
			challenge = query.Get("code_challenge")
			audience = "lite-test"
			if query.Get("code_challenge_method") != "S256" || nonce == "" {
				t.Fatal("missing PKCE or nonce")
			}
			if scenario == "bad nonce" {
				nonce = "wrong"
			}
			if scenario == "bad audience" {
				audience = "wrong"
			}
			if scenario == "bad state" {
				state = "wrong"
			}
			callback := authCall(m, "GET", "oidc/callback?code=test&state="+url.QueryEscape(state), nil, start.Result().Cookies()[0])
			if scenario != "valid" {
				if callback.Header().Get("Location") != "/?authError=sso" {
					t.Fatal("accepted invalid identity")
				}
				return
			}
			if callback.Header().Get("Location") != "/" {
				t.Fatal(callback.Header())
			}
			var sessionCookie *http.Cookie
			for _, c := range callback.Result().Cookies() {
				if c.Name == cookieName {
					sessionCookie = c
				}
			}
			if sessionCookie == nil || protectedStatus(m, sessionCookie) != 204 {
				t.Fatal("SSO did not establish session")
			}
			users := m.users.list()
			if len(users) != 2 {
				t.Fatal(users)
			}
			u, _ := m.users.get(userID(issuer, "oidc-subject"))
			if u.Role != "user" || u.Provider != "oidc" {
				t.Fatal("OIDC user was not least privilege")
			}
			replay := authCall(m, "GET", "oidc/callback?code=test&state="+url.QueryEscape(state), nil, start.Result().Cookies()[0])
			if replay.Header().Get("Location") != "/?authError=sso" {
				t.Fatal("accepted replayed state")
			}
		})
	}
}

func TestLocalLoginSurvivesOIDCOutage(t *testing.T) {
	m := testManager(t)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer provider.Close()
	cfg := m.cfg
	cfg.OIDCIssuer, cfg.OIDCClientID = provider.URL, "lite-test"
	withSSO, err := New(cfg, m.logger)
	if err != nil {
		t.Fatalf("provider outage prevented startup: %v", err)
	}
	t.Cleanup(func() {
		for _, u := range withSSO.users.list() {
			withSSO.revoke(u.ID)
		}
	})
	sso := authCall(withSSO, "GET", "oidc/login", nil, nil)
	if sso.Code != http.StatusSeeOther || sso.Header().Get("Location") != "/?authError=sso" {
		t.Fatal("SSO failure did not return to local sign-in")
	}
	cookie := loginCookie(t, withSSO, "admin", testPassword)
	if protectedStatus(withSSO, cookie) != http.StatusNoContent {
		t.Fatal("local sign-in unavailable during provider outage")
	}
}
