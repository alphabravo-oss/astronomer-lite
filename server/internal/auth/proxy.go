package auth

import (
	"errors"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
)

func (m *Manager) validateProxy() error {
	if m.cfg.ProxyUserHeader == "" {
		if m.cfg.ProxyGroupsHeader != "" || len(m.cfg.ProxyAdminGroups)+len(m.cfg.ProxyRequiredGroups) > 0 {
			return errors.New("proxy groups require a proxy user header")
		}
		return nil
	}
	header := regexp.MustCompile(`(?i)^X-[A-Z0-9-]{1,60}$`)
	if len(m.trustedProxies) == 0 || !header.MatchString(m.cfg.ProxyUserHeader) || strings.EqualFold(m.cfg.ProxyUserHeader, "X-Forwarded-For") {
		return errors.New("proxy identity requires trusted proxy CIDRs and a dedicated X- user header")
	}
	if len(m.cfg.ProxyAdminGroups)+len(m.cfg.ProxyRequiredGroups) > 0 && m.cfg.ProxyGroupsHeader == "" {
		return errors.New("proxy group mappings require a groups header")
	}
	if m.cfg.ProxyGroupsHeader != "" && (!header.MatchString(m.cfg.ProxyGroupsHeader) || strings.EqualFold(m.cfg.ProxyUserHeader, m.cfg.ProxyGroupsHeader) || strings.EqualFold(m.cfg.ProxyGroupsHeader, "X-Forwarded-For")) {
		return errors.New("proxy groups require a distinct dedicated X- header")
	}
	return nil
}

func (m *Manager) proxyIdentity(r *http.Request) (User, error) {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	peer, err := netip.ParseAddr(host)
	if err != nil || m.cfg.ProxyUserHeader == "" || !m.trusted(peer) {
		return User{}, errors.New("trusted identity proxy required")
	}
	values := r.Header.Values(m.cfg.ProxyUserHeader)
	if len(values) != 1 || strings.TrimSpace(values[0]) == "" || len(values[0]) > 256 || strings.ContainsAny(values[0], "\r\n\x00") {
		return User{}, errors.New("valid proxy identity required")
	}
	subject := strings.TrimSpace(values[0])
	groups := strings.Split(r.Header.Get(m.cfg.ProxyGroupsHeader), ",")
	if len(groups) > 128 {
		return User{}, errors.New("too many proxy groups")
	}
	contains := func(allowed []string) bool {
		for _, g := range groups {
			for _, a := range allowed {
				if strings.TrimSpace(g) == strings.TrimSpace(a) {
					return true
				}
			}
		}
		return false
	}
	if len(m.cfg.ProxyRequiredGroups) > 0 && !contains(m.cfg.ProxyRequiredGroups) {
		return User{}, errors.New("proxy group membership does not permit sign-in")
	}
	user, err := m.users.externalUser("proxy", "proxy:"+m.origin, subject, subject)
	if err != nil || len(m.cfg.ProxyAdminGroups) == 0 {
		return user, err
	}
	role := "user"
	if contains(m.cfg.ProxyAdminGroups) {
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
	if changed {
		m.revoke(user.ID)
	}
	return a.User, err
}

func (m *Manager) proxyLogin(w http.ResponseWriter, r *http.Request) {
	if m.limited(r) {
		failure(w, 429, "too many attempts")
		return
	}
	u, err := m.proxyIdentity(r)
	if err != nil {
		failure(w, 403, "trusted proxy identity required")
		return
	}
	m.newSession(w, u, sessionLifetime, "")
	m.logger.Info("user signed in", "user", u.ID, "provider", "proxy")
	jsonResponse(w, 200, u)
}

func (m *Manager) trusted(ip netip.Addr) bool {
	for _, prefix := range m.trustedProxies {
		if prefix.Contains(ip.Unmap()) {
			return true
		}
	}
	return false
}
func (m *Manager) clientIP(r *http.Request) netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	if !m.trusted(peer) {
		return peer.Unmap()
	}
	forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	if len(forwarded) > 32 {
		return peer.Unmap()
	}
	for i := len(forwarded) - 1; i >= 0; i-- {
		ip, err := netip.ParseAddr(strings.TrimSpace(forwarded[i]))
		if err != nil {
			return peer.Unmap()
		}
		if !m.trusted(ip) || i == 0 {
			return ip.Unmap()
		}
	}
	return peer.Unmap()
}
