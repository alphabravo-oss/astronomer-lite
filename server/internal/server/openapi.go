package server

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/alphabravo/astronomer-lite/server/internal/cache"
)

const openAPITTL = 10 * time.Minute

// openAPICache is a process-wide cache of /openapi/v2 bodies keyed by cluster
// id. It is initialized in init() and registered with the Registry's
// invalidation hook in Server.New so per-cluster state is dropped when a
// kubeconfig disappears or is reloaded.
var openAPICache = cache.NewTTLCache[[]byte](openAPITTL)

func (s *Server) handleOpenAPI(w http.ResponseWriter, r *http.Request, id string) {
	body, err := s.fetchOpenAPIv2(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=600")
	_, _ = w.Write(body)
}

func (s *Server) fetchOpenAPIv2(ctx context.Context, id string) ([]byte, error) {
	return openAPICache.Do(id, func() ([]byte, error) {
		client, err := s.registry.Client(id)
		if err != nil {
			return nil, err
		}
		req := client.RESTClient().Get().AbsPath("/openapi/v2")
		body, err := req.Do(ctx).Raw()
		if err != nil {
			return nil, fmt.Errorf("openapi v2: %w", err)
		}
		if len(body) == 0 {
			return nil, fmt.Errorf("openapi v2: empty response")
		}
		return body, nil
	})
}
