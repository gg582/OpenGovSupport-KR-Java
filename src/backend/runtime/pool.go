// Package runtime provides the request-handling fabric: a bounded worker
// pool with two priority lanes, single-flight batching, and a SIMD-ready
// numerics abstraction. The HTTP handlers are oblivious to all of this —
// they remain plain http.HandlerFunc values and are dispatched here.
package runtime

import (
	"net/http"
	"os"
	goruntime "runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// Pool dispatches incoming HTTP requests onto a bounded set of worker
// goroutines. Two queues (fast / slow) are drained with the fast lane
// preferred — small requests do not get stuck behind heavy ones.
type Pool struct {
	workers   int
	fast      chan *job
	slow      chan *job
	threshold int64

	stats struct {
		Accepted  atomic.Uint64
		Rejected  atomic.Uint64
		Processed atomic.Uint64
		FastDepth atomic.Int64
		SlowDepth atomic.Int64
		LatencyNs atomic.Uint64 // running sum, divide by Processed for avg
	}

	stop chan struct{}
}

// job is reused via sync.Pool to avoid per-request allocation. The wg is
// reset for each cycle (Add(1) on acquire, Done() at run end, Wait() in
// caller). A pooled WaitGroup beats per-request channel allocation.
type job struct {
	w  http.ResponseWriter
	r  *http.Request
	h  http.Handler
	wg sync.WaitGroup
	t0 time.Time
}

var jobPool = sync.Pool{
	New: func() any { return &job{} },
}

// NewPool builds a pool sized from env vars when present:
//
//	POOL_WORKERS         number of worker goroutines (default = NumCPU)
//	POOL_QUEUE           per-lane queue capacity     (default = 1024)
//	POOL_FAST_THRESHOLD  bytes below which a request goes to the fast lane
//	                     (default = 4096; -1 to disable lane split)
func NewPool() *Pool {
	workers := envInt("POOL_WORKERS", goruntime.NumCPU())
	if workers < 1 {
		workers = 1
	}
	queue := envInt("POOL_QUEUE", 1024)
	if queue < 1 {
		queue = 1
	}
	threshold := int64(envInt("POOL_FAST_THRESHOLD", 4096))
	p := &Pool{
		workers:   workers,
		fast:      make(chan *job, queue),
		slow:      make(chan *job, queue),
		threshold: threshold,
		stop:      make(chan struct{}),
	}
	for i := 0; i < workers; i++ {
		go p.worker()
	}
	return p
}

func (p *Pool) Stop() { close(p.stop) }

// Middleware hands every request off to the worker pool. The HTTP server's
// own goroutine then blocks until a worker picks the job up — this is the
// back-pressure mechanism: when both lanes are full, requests are rejected
// with 503 instead of unbounded goroutine growth.
func (p *Pool) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		j := jobPool.Get().(*job)
		j.w = w
		j.r = r
		j.h = next
		j.wg.Add(1)
		j.t0 = time.Now()

		small := r.ContentLength >= 0 && r.ContentLength < p.threshold
		var primary, alt chan *job
		var primaryDepth, altDepth *atomic.Int64
		if small {
			primary, primaryDepth = p.fast, &p.stats.FastDepth
			alt, altDepth = p.slow, &p.stats.SlowDepth
		} else {
			primary, primaryDepth = p.slow, &p.stats.SlowDepth
			alt, altDepth = p.fast, &p.stats.FastDepth
		}

		select {
		case primary <- j:
			primaryDepth.Add(1)
			p.stats.Accepted.Add(1)
		default:
			select {
			case alt <- j:
				altDepth.Add(1)
				p.stats.Accepted.Add(1)
			default:
				p.stats.Rejected.Add(1)
				j.wg.Done() // balance the Add
				j.h, j.w, j.r = nil, nil, nil
				jobPool.Put(j)
				w.Header().Set("Retry-After", "1")
				http.Error(w, "server is at capacity, retry shortly", http.StatusServiceUnavailable)
				return
			}
		}
		j.wg.Wait()
		// release after the worker is done (so we don't recycle while it's still running)
		j.h, j.w, j.r = nil, nil, nil
		jobPool.Put(j)
	})
}

func (p *Pool) worker() {
	for {
		// Always prefer the fast lane: drain it as long as there is work.
		select {
		case j := <-p.fast:
			p.stats.FastDepth.Add(-1)
			p.run(j)
			continue
		default:
		}
		// Fast lane empty — block on either lane.
		select {
		case j := <-p.fast:
			p.stats.FastDepth.Add(-1)
			p.run(j)
		case j := <-p.slow:
			p.stats.SlowDepth.Add(-1)
			p.run(j)
		case <-p.stop:
			return
		}
	}
}

func (p *Pool) run(j *job) {
	defer func() {
		_ = recover() // never let one handler take down a worker
		p.stats.LatencyNs.Add(uint64(time.Since(j.t0).Nanoseconds()))
		p.stats.Processed.Add(1)
		j.wg.Done()
	}()
	j.h.ServeHTTP(j.w, j.r)
}

// Snapshot is suitable for /api/runtime/stats.
type Snapshot struct {
	Workers         int    `json:"workers"`
	FastQueueDepth  int64  `json:"fastQueueDepth"`
	SlowQueueDepth  int64  `json:"slowQueueDepth"`
	Accepted        uint64 `json:"accepted"`
	Rejected        uint64 `json:"rejected"`
	Processed       uint64 `json:"processed"`
	AvgLatencyMicro uint64 `json:"avgLatencyMicro"`
}

func (p *Pool) Snapshot() Snapshot {
	processed := p.stats.Processed.Load()
	avg := uint64(0)
	if processed > 0 {
		avg = p.stats.LatencyNs.Load() / processed / 1000
	}
	return Snapshot{
		Workers:         p.workers,
		FastQueueDepth:  p.stats.FastDepth.Load(),
		SlowQueueDepth:  p.stats.SlowDepth.Load(),
		Accepted:        p.stats.Accepted.Load(),
		Rejected:        p.stats.Rejected.Load(),
		Processed:       processed,
		AvgLatencyMicro: avg,
	}
}

func envInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
