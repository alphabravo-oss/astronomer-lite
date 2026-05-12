// Package cache provides shared in-memory caches used by the server.
//
// TTLCache is a typed, mutex-protected key/value store with per-cache TTL and
// optional singleflight deduplication of concurrent fetches. It replaces the
// ad-hoc per-feature caches that used to live in the server package.
package cache

import (
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// TTLCache is a generic time-bounded cache.
//
// Entries written via Put are returned by Get until the configured TTL has
// elapsed since the write. Reads after expiry behave as a miss. The zero value
// is not usable; construct via NewTTLCache.
type TTLCache[V any] struct {
	ttl    time.Duration
	mu     sync.RWMutex
	values map[string]ttlEntry[V]
	sf     singleflight.Group
}

type ttlEntry[V any] struct {
	value     V
	fetchedAt time.Time
}

// NewTTLCache returns an empty cache with the given TTL. A non-positive TTL
// makes every entry effectively immediate-miss (useful for tests).
func NewTTLCache[V any](ttl time.Duration) *TTLCache[V] {
	return &TTLCache[V]{
		ttl:    ttl,
		values: map[string]ttlEntry[V]{},
	}
}

// Get returns the cached value for key if present and unexpired.
func (c *TTLCache[V]) Get(key string) (V, bool) {
	var zero V
	if c == nil {
		return zero, false
	}
	c.mu.RLock()
	entry, ok := c.values[key]
	c.mu.RUnlock()
	if !ok {
		return zero, false
	}
	if c.ttl > 0 && time.Since(entry.fetchedAt) >= c.ttl {
		return zero, false
	}
	return entry.value, true
}

// Put stores value under key, overwriting any prior entry.
func (c *TTLCache[V]) Put(key string, value V) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.values[key] = ttlEntry[V]{value: value, fetchedAt: time.Now()}
	c.mu.Unlock()
}

// Invalidate drops the entry for key. Safe to call when key is not present.
func (c *TTLCache[V]) Invalidate(key string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	delete(c.values, key)
	c.mu.Unlock()
}

// InvalidatePrefix drops every entry whose key starts with prefix. The Registry
// uses this with a "<clusterID>:" prefix to clear per-cluster state when a
// kubeconfig is removed or reloaded.
func (c *TTLCache[V]) InvalidatePrefix(prefix string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	for k := range c.values {
		if strings.HasPrefix(k, prefix) {
			delete(c.values, k)
		}
	}
	c.mu.Unlock()
}

// Clear removes all entries.
func (c *TTLCache[V]) Clear() {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.values = map[string]ttlEntry[V]{}
	c.mu.Unlock()
}

// Do returns the cached value if present and unexpired, otherwise calls fn,
// stores the result, and returns it. Concurrent callers for the same key share
// a single fn invocation via singleflight.
func (c *TTLCache[V]) Do(key string, fn func() (V, error)) (V, error) {
	if v, ok := c.Get(key); ok {
		return v, nil
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		// Re-check inside the singleflight in case another goroutine populated
		// the entry between our miss and acquiring the flight.
		if v, ok := c.Get(key); ok {
			return v, nil
		}
		v, err := fn()
		if err != nil {
			return v, err
		}
		c.Put(key, v)
		return v, nil
	})
	if err != nil {
		var zero V
		return zero, err
	}
	return v.(V), nil
}
