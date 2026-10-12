// Package desktop protects the private launcher-to-server connection.
package desktop

import (
	"crypto/subtle"
	"fmt"
	"net/http"
)

func Guard(next http.Handler, token, host string) (http.Handler, error) {
	if token == "" {
		return next, nil
	}
	if len(token) < 32 || host != "127.0.0.1" {
		return nil, fmt.Errorf("desktop mode requires a private token and IPv4 loopback listener")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Astronomer-Desktop")), []byte(token)) != 1 {
			http.Error(w, "desktop connection required", http.StatusUnauthorized)
			return
		}
		r.Header.Del("X-Astronomer-Desktop")
		next.ServeHTTP(w, r)
	}), nil
}
