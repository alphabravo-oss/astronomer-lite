package server

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"k8s.io/client-go/rest"
)

// readOnlyProxyMethods are the HTTP verbs the raw /k8s/* passthrough accepts.
// The proxy is an unauthenticated-at-this-layer escape hatch (RBAC is enforced
// upstream by the API server using the cluster credential), and it currently
// has no first-party consumer. Restricting it to read verbs removes an ungated
// mutating surface; all writes must go through the typed handlers, which
// preflight a SelfSubjectAccessReview.
var readOnlyProxyMethods = map[string]bool{
	http.MethodGet:  true,
	http.MethodHead: true,
}

func (s *Server) handleKubernetesProxy(w http.ResponseWriter, r *http.Request, id string, suffix string) {
	if !readOnlyProxyMethods[r.Method] {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("the /k8s proxy is read-only; use the typed resource endpoints for writes"))
		return
	}
	cfg, err := s.registry.RESTConfig(id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	target, err := url.Parse(cfg.Host)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	transport, err := rest.TransportFor(cfg)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if suffix == "" {
		suffix = "/"
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = transport
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		writeError(w, http.StatusBadGateway, err)
	}
	proxy.Director = func(req *http.Request) {
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.URL.Path = singleJoiningSlash(target.Path, suffix)
		req.URL.RawPath = ""
		req.URL.RawQuery = r.URL.RawQuery
		req.Host = target.Host
		if cfg.UserAgent != "" {
			req.Header.Set("User-Agent", cfg.UserAgent)
		}
	}
	proxy.ServeHTTP(w, r)
}

func singleJoiningSlash(left string, right string) string {
	leftSlash := strings.HasSuffix(left, "/")
	rightSlash := strings.HasPrefix(right, "/")
	switch {
	case leftSlash && rightSlash:
		return left + right[1:]
	case !leftSlash && !rightSlash:
		return left + "/" + right
	default:
		return left + right
	}
}
