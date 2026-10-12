package auth

import (
	"encoding/base32"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTOTPVectorsAndReplay(t *testing.T) {
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte("12345678901234567890"))
	for counter, expected := range map[int64]string{0: "755224", 1: "287082", 2: "359152", 3: "969429"} {
		if got := totp(secret, counter); got != expected {
			t.Fatalf("counter %d: %s != %s", counter, got, expected)
		}
	}
	now := time.Unix(59, 0)
	if _, ok := acceptTOTP(secret, "287082", 0, now); !ok {
		t.Fatal("valid code rejected")
	}
	if _, ok := acceptTOTP(secret, "287082", 1, now); ok {
		t.Fatal("replayed code accepted")
	}
	if _, ok := acceptTOTP("", "000000", 0, now); ok {
		t.Fatal("empty key accepted")
	}
}

func TestMFAEnrollmentRecoveryAndSessionRevocation(t *testing.T) {
	m := testManager(t)
	cookie := loginCookie(t, m, "admin", testPassword)
	before, _ := m.users.get(userID("local", "admin"))
	begin := authCall(m, "POST", "mfa/begin", map[string]string{"password": testPassword}, cookie)
	if begin.Code != 200 {
		t.Fatal(begin.Code, begin.Body.String())
	}
	var enrollment map[string]string
	if err := json.Unmarshal(begin.Body.Bytes(), &enrollment); err != nil {
		t.Fatal(err)
	}
	code := totp(enrollment["secret"], time.Now().Unix()/30)
	enabled := authCall(m, "POST", "mfa/enable", map[string]string{"password": testPassword, "code": code}, cookie)
	if enabled.Code != 200 {
		t.Fatal(enabled.Code, enabled.Body.String())
	}
	var result struct {
		User  User     `json:"user"`
		Codes []string `json:"recoveryCodes"`
	}
	if err := json.Unmarshal(enabled.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.User.MFAEnabled || len(result.Codes) != 8 {
		t.Fatal("missing MFA or recovery codes")
	}
	if protectedStatus(m, cookie) != 401 {
		t.Fatal("enabling MFA left old session active")
	}
	late := httptest.NewRecorder()
	m.newSession(late, before.User, sessionLifetime, before.PasswordHash, before.AuthVersion)
	if protectedStatus(m, late.Result().Cookies()[0]) != 401 {
		t.Fatal("in-flight password-only login bypassed enrollment")
	}
	attempt := func(code string) *httptest.ResponseRecorder {
		return authCall(m, "POST", "login", map[string]string{"username": "admin", "password": testPassword, "code": code}, nil)
	}
	if response := attempt(""); response.Code != 401 {
		t.Fatal("password-only login accepted")
	}
	if response := attempt(code); response.Code != 401 {
		t.Fatal("enrollment code was replayed")
	}
	recovered := attempt(result.Codes[0])
	if recovered.Code != 200 {
		t.Fatal("recovery failed", recovered.Body.String())
	}
	if response := attempt(result.Codes[0]); response.Code != 401 {
		t.Fatal("recovery code was replayed")
	}
	persisted, err := openUsers(m.users.path)
	if err != nil {
		t.Fatal(err)
	}
	saved, _ := persisted.get(before.ID)
	if !saved.MFAEnabled || len(saved.RecoveryHashes) != 7 {
		t.Fatal("MFA state did not persist")
	}
	disabled := authCall(m, "POST", "mfa/disable", map[string]string{"password": testPassword, "code": result.Codes[1]}, recovered.Result().Cookies()[0])
	if disabled.Code != 200 {
		t.Fatal(disabled.Code, disabled.Body.String())
	}
	if protectedStatus(m, recovered.Result().Cookies()[0]) != 401 {
		t.Fatal("disabling MFA left old session active")
	}
	final, _ := m.users.get(before.ID)
	if final.MFAEnabled || final.TOTPSecret != "" || len(final.RecoveryHashes) != 0 {
		t.Fatal("MFA secrets retained after disabling")
	}
}
