package cache

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestTTLCacheGetPut(t *testing.T) {
	c := NewTTLCache[string](time.Minute)
	if _, ok := c.Get("missing"); ok {
		t.Fatalf("expected miss for absent key")
	}
	c.Put("k", "v")
	got, ok := c.Get("k")
	if !ok || got != "v" {
		t.Fatalf("Get after Put: got (%q,%v) want (\"v\",true)", got, ok)
	}
}

func TestTTLCacheExpiry(t *testing.T) {
	c := NewTTLCache[int](10 * time.Millisecond)
	c.Put("k", 42)
	if v, ok := c.Get("k"); !ok || v != 42 {
		t.Fatalf("immediate Get failed: (%d,%v)", v, ok)
	}
	time.Sleep(25 * time.Millisecond)
	if _, ok := c.Get("k"); ok {
		t.Fatalf("entry should have expired")
	}
}

func TestTTLCacheInvalidate(t *testing.T) {
	c := NewTTLCache[string](time.Minute)
	c.Put("a", "1")
	c.Put("b", "2")
	c.Invalidate("a")
	if _, ok := c.Get("a"); ok {
		t.Fatalf("a should have been invalidated")
	}
	if v, ok := c.Get("b"); !ok || v != "2" {
		t.Fatalf("b should remain: (%q,%v)", v, ok)
	}
}

func TestTTLCacheInvalidatePrefix(t *testing.T) {
	c := NewTTLCache[int](time.Minute)
	c.Put("cluster1:openapi", 1)
	c.Put("cluster1:prom", 2)
	c.Put("cluster2:openapi", 3)
	c.InvalidatePrefix("cluster1:")
	if _, ok := c.Get("cluster1:openapi"); ok {
		t.Fatalf("cluster1:openapi should be cleared")
	}
	if _, ok := c.Get("cluster1:prom"); ok {
		t.Fatalf("cluster1:prom should be cleared")
	}
	if v, ok := c.Get("cluster2:openapi"); !ok || v != 3 {
		t.Fatalf("cluster2:openapi should survive: (%d,%v)", v, ok)
	}
}

func TestTTLCacheClear(t *testing.T) {
	c := NewTTLCache[string](time.Minute)
	c.Put("a", "1")
	c.Put("b", "2")
	c.Clear()
	if _, ok := c.Get("a"); ok {
		t.Fatalf("a should be cleared")
	}
	if _, ok := c.Get("b"); ok {
		t.Fatalf("b should be cleared")
	}
}

func TestTTLCacheDoCachesValue(t *testing.T) {
	c := NewTTLCache[string](time.Minute)
	var calls int32
	fn := func() (string, error) {
		atomic.AddInt32(&calls, 1)
		return "v", nil
	}
	for i := 0; i < 3; i++ {
		got, err := c.Do("k", fn)
		if err != nil || got != "v" {
			t.Fatalf("Do iteration %d: (%q, %v)", i, got, err)
		}
	}
	if calls != 1 {
		t.Fatalf("fn should run once, ran %d times", calls)
	}
}

func TestTTLCacheDoSingleflight(t *testing.T) {
	c := NewTTLCache[int](time.Minute)
	var calls int32
	var wg sync.WaitGroup
	start := make(chan struct{})
	fn := func() (int, error) {
		atomic.AddInt32(&calls, 1)
		time.Sleep(20 * time.Millisecond)
		return 7, nil
	}
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			v, err := c.Do("k", fn)
			if err != nil || v != 7 {
				t.Errorf("Do returned (%d, %v)", v, err)
			}
		}()
	}
	close(start)
	wg.Wait()
	if calls != 1 {
		t.Fatalf("singleflight should coalesce concurrent calls, got %d", calls)
	}
}

func TestTTLCacheDoDoesNotCacheError(t *testing.T) {
	c := NewTTLCache[string](time.Minute)
	var calls int32
	wantErr := errors.New("boom")
	fn := func() (string, error) {
		atomic.AddInt32(&calls, 1)
		return "", wantErr
	}
	if _, err := c.Do("k", fn); !errors.Is(err, wantErr) {
		t.Fatalf("first Do error = %v, want %v", err, wantErr)
	}
	if _, err := c.Do("k", fn); !errors.Is(err, wantErr) {
		t.Fatalf("second Do error = %v, want %v", err, wantErr)
	}
	if calls != 2 {
		t.Fatalf("error should not be cached, calls=%d", calls)
	}
}

func TestNilCacheSafe(t *testing.T) {
	var c *TTLCache[string]
	if _, ok := c.Get("k"); ok {
		t.Fatalf("nil cache Get must miss")
	}
	c.Put("k", "v") // must not panic
	c.Invalidate("k")
	c.InvalidatePrefix("k")
	c.Clear()
}
