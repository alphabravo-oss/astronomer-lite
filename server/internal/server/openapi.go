package server

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"
)

const openAPITTL = 10 * time.Minute

type openAPICacheEntry struct {
	body      []byte
	fetchedAt time.Time
}

var (
	openAPICacheMu sync.RWMutex
	openAPICache   = map[string]openAPICacheEntry{}
)

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
	openAPICacheMu.RLock()
	entry, ok := openAPICache[id]
	openAPICacheMu.RUnlock()
	if ok && time.Since(entry.fetchedAt) < openAPITTL && len(entry.body) > 0 {
		return entry.body, nil
	}
	client, err := s.registry.Client(id)
	if err != nil {
		return nil, err
	}
	req := client.RESTClient().Get().AbsPath("/openapi/v2")
	body, err := req.Do(ctx).Raw()
	if err != nil {
		return nil, fmt.Errorf("openapi v2: %w", err)
	}
	openAPICacheMu.Lock()
	openAPICache[id] = openAPICacheEntry{body: body, fetchedAt: time.Now()}
	openAPICacheMu.Unlock()
	return body, nil
}
