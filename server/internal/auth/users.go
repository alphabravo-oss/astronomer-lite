package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"

	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	Role       string `json:"role"`
	Provider   string `json:"provider"`
	Disabled   bool   `json:"disabled"`
	MFAEnabled bool   `json:"mfaEnabled"`
}
type account struct {
	User
	PasswordHash   string   `json:"passwordHash,omitempty"`
	TOTPSecret     string   `json:"totpSecret,omitempty"`
	TOTPLast       int64    `json:"totpLast,omitempty"`
	RecoveryHashes []string `json:"recoveryHashes,omitempty"`
	AuthVersion    int      `json:"authVersion,omitempty"`
}
type userStore struct {
	mu       sync.Mutex
	path     string
	accounts map[string]account
}

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.@-]{2,63}$`)

func userID(provider, subject string) string {
	sum := sha256.Sum256([]byte(provider + "\x00" + subject))
	return hex.EncodeToString(sum[:])
}

func openUsers(path string) (*userStore, error) {
	s := &userStore{path: path, accounts: map[string]account{}}
	data, err := os.ReadFile(path)
	if err == nil {
		err = json.Unmarshal(data, &s.accounts)
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if s.accounts == nil {
		return nil, errors.New("invalid account store")
	}
	return s, nil
}

func (s *userStore) save(next map[string]account) error {
	data, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(s.path), ".users-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(f.Name()) }()
	if _, err = f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), s.path); err != nil {
		return err
	}
	s.accounts = next
	return nil
}

func (s *userStore) put(a account) error {
	next := make(map[string]account, len(s.accounts)+1)
	for id, old := range s.accounts {
		next[id] = old
	}
	next[a.ID] = a
	return s.save(next)
}

func (s *userStore) get(id string) (account, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.accounts[id]
	return a, ok
}
func (s *userStore) list() []User {
	s.mu.Lock()
	defer s.mu.Unlock()
	users := make([]User, 0, len(s.accounts))
	for _, a := range s.accounts {
		users = append(users, a.User)
	}
	sort.Slice(users, func(i, j int) bool { return users[i].Username < users[j].Username })
	return users
}
func passwordHash(password string) (string, error) {
	if len(password) < 12 || len(password) > 72 {
		return "", errors.New("password must contain 12 to 72 bytes")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	return string(hash), err
}
func (s *userStore) create(username, password, role string) (User, error) {
	if !usernamePattern.MatchString(username) {
		return User{}, errors.New("username must be 3–64 letters, numbers, dots, underscores, @ or hyphens")
	}
	if role != "admin" && role != "user" {
		return User{}, errors.New("role must be admin or user")
	}
	hash, err := passwordHash(password)
	if err != nil {
		return User{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := userID("local", username)
	if len(s.accounts) >= 1000 {
		return User{}, errors.New("account limit reached")
	}
	if _, ok := s.accounts[id]; ok {
		return User{}, errors.New("username already exists")
	}
	a := account{User: User{ID: id, Username: username, Role: role, Provider: "local"}, PasswordHash: hash}
	return a.User, s.put(a)
}
func (s *userStore) update(id, role string, disabled bool, password string) (User, error) {
	if role != "admin" && role != "user" {
		return User{}, errors.New("role must be admin or user")
	}
	var hash string
	var err error
	if password != "" {
		hash, err = passwordHash(password)
		if err != nil {
			return User{}, err
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.accounts[id]
	if !ok {
		return User{}, errors.New("user not found")
	}
	if hash != "" && a.Provider != "local" {
		return User{}, errors.New("SSO passwords are managed by your identity provider")
	}
	if a.Role == "admin" && !a.Disabled && (role != "admin" || disabled) {
		count := 0
		for _, other := range s.accounts {
			if other.Role == "admin" && !other.Disabled {
				count++
			}
		}
		if count <= 1 {
			return User{}, errors.New("cannot disable or demote the last administrator")
		}
	}
	a.Role, a.Disabled = role, disabled
	if hash != "" {
		a.PasswordHash = hash
	}
	return a.User, s.put(a)
}
func (s *userStore) oidcUser(issuer, subject, name string) (User, error) {
	return s.externalUser("oidc", issuer, subject, name)
}
func (s *userStore) externalUser(provider, issuer, subject, name string) (User, error) {
	if subject == "" {
		return User{}, errors.New("missing OIDC subject")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := userID(issuer, subject)
	if a, ok := s.accounts[id]; ok {
		if a.Disabled {
			return User{}, errors.New("account disabled")
		}
		return a.User, nil
	}
	if len(s.accounts) >= 1000 {
		return User{}, fmt.Errorf("account limit reached")
	}
	if name == "" {
		name = subject
	}
	a := account{User: User{ID: id, Username: name, Role: "user", Provider: provider}}
	return a.User, s.put(a)
}

func (s *userStore) changePassword(id, expectedHash, password string) (account, error) {
	hash, err := passwordHash(password)
	if err != nil {
		return account{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.accounts[id]
	if !ok || a.Disabled || a.PasswordHash != expectedHash {
		return account{}, errors.New("account changed; sign in again")
	}
	a.PasswordHash = hash
	return a, s.put(a)
}
