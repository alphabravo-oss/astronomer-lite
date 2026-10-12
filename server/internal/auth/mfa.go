package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type mfaEnrollment struct {
	Secret       string
	PasswordHash string
	Expires      time.Time
}

func totp(secret string, counter int64) string {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil || len(key) < 20 {
		return ""
	}
	var input [8]byte
	binary.BigEndian.PutUint64(input[:], uint64(counter))
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(input[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 15
	number := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", number%1000000)
}

func acceptTOTP(secret, code string, last int64, now time.Time) (int64, bool) {
	if len(code) != 6 {
		return 0, false
	}
	for _, shift := range []int64{0, -1, 1} {
		counter := now.Unix()/30 + shift
		if counter > last && subtle.ConstantTimeCompare([]byte(totp(secret, counter)), []byte(code)) == 1 {
			return counter, true
		}
	}
	return 0, false
}
func recoveryHash(code string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(sum[:])
}
func consumeFactor(a *account, code string) bool {
	if counter, valid := acceptTOTP(a.TOTPSecret, strings.TrimSpace(code), a.TOTPLast, time.Now()); valid {
		a.TOTPLast = counter
		return true
	}
	hash := recoveryHash(code)
	for i, value := range a.RecoveryHashes {
		if subtle.ConstantTimeCompare([]byte(hash), []byte(value)) == 1 {
			a.RecoveryHashes = append(append([]string{}, a.RecoveryHashes[:i]...), a.RecoveryHashes[i+1:]...)
			return true
		}
	}
	return false
}
func (s *userStore) checkSecondFactor(expected account, code string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.accounts[expected.ID]
	if !ok || a.Disabled || a.PasswordHash != expected.PasswordHash || a.AuthVersion != expected.AuthVersion {
		return false
	}
	if !a.MFAEnabled {
		return true
	}
	if !consumeFactor(&a, code) {
		return false
	}
	return s.put(a) == nil
}

func (m *Manager) manageMFA(w http.ResponseWriter, r *http.Request, user User) {
	if user.Provider != "local" {
		failure(w, 400, "manage SSO MFA at your identity provider")
		return
	}
	if m.limited(r) {
		failure(w, 429, "too many attempts")
		return
	}
	var body struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !decode(w, r, &body) {
		return
	}
	select {
	case m.bcryptSlots <- struct{}{}:
		defer func() { <-m.bcryptSlots }()
	default:
		failure(w, 429, "authentication is busy")
		return
	}
	current, ok := m.users.get(user.ID)
	if !ok || bcrypt.CompareHashAndPassword([]byte(current.PasswordHash), []byte(body.Password)) != nil {
		failure(w, 403, "current password is incorrect")
		return
	}
	switch r.URL.Path {
	case "/api/auth/mfa/begin":
		if current.MFAEnabled {
			failure(w, 409, "MFA is already enabled")
			return
		}
		random := make([]byte, 20)
		if _, err := rand.Read(random); err != nil {
			failure(w, 500, "could not create authenticator secret")
			return
		}
		secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(random)
		m.mu.Lock()
		if m.mfaPending == nil {
			m.mfaPending = map[string]mfaEnrollment{}
		}
		for id, entry := range m.mfaPending {
			if time.Now().After(entry.Expires) {
				delete(m.mfaPending, id)
			}
		}
		m.mfaPending[user.ID] = mfaEnrollment{Secret: secret, PasswordHash: current.PasswordHash, Expires: time.Now().Add(5 * time.Minute)}
		m.mu.Unlock()
		query := url.Values{"secret": {secret}, "issuer": {"Astronomer-Lite"}, "algorithm": {"SHA1"}, "digits": {"6"}, "period": {"30"}}
		jsonResponse(w, 200, map[string]string{"secret": secret, "uri": "otpauth://totp/" + url.PathEscape("Astronomer-Lite:"+user.Username) + "?" + query.Encode()})
	case "/api/auth/mfa/enable", "/api/auth/mfa/disable":
		enable := strings.HasSuffix(r.URL.Path, "/enable")
		m.mu.Lock()
		pending := m.mfaPending[user.ID]
		m.mu.Unlock()
		var codes []string
		m.users.mu.Lock()
		a := m.users.accounts[user.ID]
		valid := !a.Disabled && a.PasswordHash == current.PasswordHash && a.AuthVersion == current.AuthVersion
		if enable {
			counter, matched := acceptTOTP(pending.Secret, body.Code, 0, time.Now())
			valid = valid && !a.MFAEnabled && pending.PasswordHash == a.PasswordHash && time.Now().Before(pending.Expires) && matched
			if valid {
				a.TOTPSecret, a.TOTPLast, a.MFAEnabled = pending.Secret, counter, true
				a.RecoveryHashes = nil
				for range 8 {
					code := randomToken()
					codes = append(codes, code)
					a.RecoveryHashes = append(a.RecoveryHashes, recoveryHash(code))
				}
			}
		} else {
			valid = valid && a.MFAEnabled && consumeFactor(&a, body.Code)
			if valid {
				a.MFAEnabled = false
				a.TOTPSecret = ""
				a.TOTPLast = 0
				a.RecoveryHashes = nil
			}
		}
		if !valid {
			m.users.mu.Unlock()
			failure(w, 403, "invalid, expired, or already used authenticator/recovery code")
			return
		}
		a.AuthVersion++
		err := m.users.put(a)
		m.users.mu.Unlock()
		if err != nil {
			failure(w, 500, "could not save MFA settings")
			return
		}
		m.mu.Lock()
		delete(m.mfaPending, user.ID)
		m.mu.Unlock()
		m.revoke(user.ID)
		m.newSession(w, a.User, sessionLifetime, a.PasswordHash, a.AuthVersion)
		jsonResponse(w, 200, map[string]any{"user": a.User, "recoveryCodes": codes})
	default:
		failure(w, 404, "unknown MFA operation")
	}
}
