package runtime

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
)

// Coalescer deduplicates concurrent identical requests. It uses N independent
// shards, each with its own mutex and inflight map, so contention scales with
// the request mix instead of being a single global hot spot.
//
// Per-flight state is tracked with a small atomic bitmask (no extra mutex):
//
//	flightStateRunning   = 1 << 0
//	flightStateCompleted = 1 << 1
//	flightStateErrored   = 1 << 2
//
// Followers wait on flight.ready (a chan close); the bitmask answers cheap
// non-blocking status questions (e.g. metrics) without locking.
type Coalescer struct {
	shards [coalesceShardCount]coalesceShard
	stats  struct {
		Hits  atomic.Uint64
		Total atomic.Uint64
	}
}

const coalesceShardCount = 32 // power of 2 — used with mask to pick a shard

type coalesceShard struct {
	mu       sync.Mutex
	inflight map[string]*flight
}

const (
	flightStateRunning   uint32 = 1 << 0
	flightStateCompleted uint32 = 1 << 1
	flightStateErrored   uint32 = 1 << 2
)

type flight struct {
	state atomic.Uint32
	ready chan struct{}
	body  []byte
	hdr   http.Header
	code  int
}

var flightPool = sync.Pool{
	New: func() any { return &flight{} },
}

func acquireFlight() *flight {
	f := flightPool.Get().(*flight)
	f.state.Store(flightStateRunning)
	f.ready = make(chan struct{})
	f.body = nil
	f.hdr = nil
	f.code = 0
	return f
}

func releaseFlight(f *flight) {
	// only return to pool once nobody else can be waiting
	f.body = nil
	f.hdr = nil
	flightPool.Put(f)
}

func NewCoalescer() *Coalescer {
	c := &Coalescer{}
	for i := range c.shards {
		c.shards[i].inflight = make(map[string]*flight, 64)
	}
	return c
}

// Middleware applies coalescing to GET / POST. All endpoints in this app are
// pure functions of the request, so deduplication is always safe.
func (c *Coalescer) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			next.ServeHTTP(w, r)
			return
		}
		c.stats.Total.Add(1)

		var bodyBytes []byte
		if r.Body != nil {
			b, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			bodyBytes = b
			_ = r.Body.Close()
		}

		key, shardIdx := requestKeyAndShard(r, bodyBytes)
		shard := &c.shards[shardIdx]

		shard.mu.Lock()
		if existing, ok := shard.inflight[key]; ok {
			shard.mu.Unlock()
			c.stats.Hits.Add(1)
			// Fast path: if already completed, replay without waiting.
			// Otherwise block on ready then replay.
			if existing.state.Load()&flightStateCompleted == 0 {
				<-existing.ready
			}
			replay(w, existing)
			return
		}
		fl := acquireFlight()
		shard.inflight[key] = fl
		shard.mu.Unlock()

		// Run the real handler against a pooled recorder.
		rec := acquireRecorder()
		r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		next.ServeHTTP(rec, r)

		fl.body = append(fl.body[:0], rec.buf.Bytes()...)
		// Copy headers so fl.hdr is owned by the flight; the recorder's
		// header map will be cleared the moment it returns to the pool.
		fl.hdr = make(http.Header, len(rec.header))
		for k, vs := range rec.header {
			fl.hdr[k] = append([]string(nil), vs...)
		}
		fl.code = rec.code
		fl.state.Store(flightStateCompleted)
		close(fl.ready)
		releaseRecorder(rec)

		// Replay first so the leader returns to its client immediately,
		// then evict. Followers that arrive between close(ready) and the
		// eviction below get the cached result via the completed-fast-path.
		replay(w, fl)

		shard.mu.Lock()
		if cur, ok := shard.inflight[key]; ok && cur == fl {
			delete(shard.inflight, key)
		}
		shard.mu.Unlock()
		// flight returns to pool only after followers have replayed; we
		// know there are no more followers because we evicted from the map
		// before replay, but existing waiters still hold a pointer. The
		// safe path is to leak it back via a delayed put — easiest by
		// piggy-backing on the next GC cycle (no-op here).
	})
}

func replay(w http.ResponseWriter, fl *flight) {
	for k, vs := range fl.hdr {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	if fl.code != 0 {
		w.WriteHeader(fl.code)
	}
	_, _ = w.Write(fl.body)
}

// requestKeyAndShard hashes method+path+body and returns both the key and a
// shard index derived from the same hash (no second hash needed).
func requestKeyAndShard(r *http.Request, body []byte) (string, int) {
	h := sha256.New()
	h.Write([]byte(r.Method))
	h.Write([]byte{0})
	h.Write([]byte(r.URL.Path))
	h.Write([]byte{0})
	h.Write(body)
	sum := h.Sum(nil)
	return hex.EncodeToString(sum), int(sum[0]) & (coalesceShardCount - 1)
}

// CoalescerSnapshot is exposed by /api/runtime/stats.
type CoalescerSnapshot struct {
	Total uint64 `json:"total"`
	Hits  uint64 `json:"hits"`
}

func (c *Coalescer) Snapshot() CoalescerSnapshot {
	return CoalescerSnapshot{
		Total: c.stats.Total.Load(),
		Hits:  c.stats.Hits.Load(),
	}
}

// ───── pooled response recorder ─────
//
// Replaces httptest.NewRecorder() which allocates a *bytes.Buffer plus a Header
// map per call. Our recorder reuses both via sync.Pool.

type recorder struct {
	header http.Header
	buf    *bytes.Buffer
	code   int
}

var recorderPool = sync.Pool{
	New: func() any {
		return &recorder{
			header: make(http.Header, 4),
			buf:    bytes.NewBuffer(make([]byte, 0, 1024)),
		}
	},
}

func acquireRecorder() *recorder {
	r := recorderPool.Get().(*recorder)
	r.code = 200
	r.buf.Reset()
	for k := range r.header {
		delete(r.header, k)
	}
	return r
}

func releaseRecorder(r *recorder) {
	if r.buf.Cap() > 64*1024 {
		// drop oversize buffers — keeps the pool's memory bounded
		r.buf = bytes.NewBuffer(make([]byte, 0, 1024))
	}
	recorderPool.Put(r)
}

func (r *recorder) Header() http.Header        { return r.header }
func (r *recorder) Write(b []byte) (int, error) { return r.buf.Write(b) }
func (r *recorder) WriteHeader(c int)           { r.code = c }
