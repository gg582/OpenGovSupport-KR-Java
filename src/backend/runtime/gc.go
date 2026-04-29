package runtime

import (
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
)

// ConfigureGC reads the GOGC_TARGET env var (e.g. "200" — meaning GOGC=200)
// and applies it. A higher value means GC runs less often → less CPU spent
// on GC at the cost of more peak heap. For request-driven services with
// short-lived allocations a value in the 200-400 range is usually a win.
func ConfigureGC() (oldPercent int, applied bool) {
	v, ok := os.LookupEnv("GOGC_TARGET")
	if !ok {
		return 0, false
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, false
	}
	old := debug.SetGCPercent(n)
	return old, true
}

// WithGCOff disables the garbage collector for the duration of fn, then
// re-enables it and forces one full collection. Use it around batched
// hot paths where allocator pressure is high but the working set is
// short-lived (e.g. CSV-style bulk imports). Safe to call concurrently —
// the GC is a process-global setting, so concurrent users will overlap.
//
// Do NOT use this on the per-request hot path: every request paying for
// a forced full GC at the end would *destroy* p99 latency.
func WithGCOff(fn func()) {
	prev := debug.SetGCPercent(-1)
	defer func() {
		debug.SetGCPercent(prev)
		runtime.GC()
	}()
	fn()
}

// WithGCBumped temporarily raises GOGC to `percent` for fn, restoring the
// previous value after. Suitable for medium-burst phases where you want
// fewer GCs but cannot afford to disable collection entirely.
func WithGCBumped(percent int, fn func()) {
	prev := debug.SetGCPercent(percent)
	defer debug.SetGCPercent(prev)
	fn()
}
