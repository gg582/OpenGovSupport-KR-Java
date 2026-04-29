// loadtest runs a closed-loop HTTP load test against the backend and prints
// RPS / latency percentiles. Self-contained — no third-party deps.
//
//	go run ./cmd/loadtest -url http://localhost:8080/api/overseas/care \
//	    -concurrency 200 -duration 10s -body '{"departureDate":"2026-01-15"}'
package main

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

func main() {
	url := flag.String("url", "http://localhost:8080/api/overseas/care", "target URL")
	method := flag.String("method", "POST", "HTTP method")
	body := flag.String("body", `{"departureDate":"2026-01-15"}`, "request body")
	concurrency := flag.Int("concurrency", 100, "concurrent goroutines")
	duration := flag.Duration("duration", 5*time.Second, "test duration")
	bodies := flag.String("bodies", "", "newline-separated bodies; if set, requests rotate through them")
	warmup := flag.Duration("warmup", 500*time.Millisecond, "warm-up duration before measurement")
	flag.Parse()

	var corpus [][]byte
	if *bodies != "" {
		raw, err := os.ReadFile(*bodies)
		if err != nil {
			fmt.Fprintln(os.Stderr, "bodies file:", err)
			os.Exit(1)
		}
		for _, line := range strings.Split(string(raw), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			corpus = append(corpus, []byte(line))
		}
	} else {
		corpus = [][]byte{[]byte(*body)}
	}

	// keep-alive transport
	tr := &http.Transport{
		MaxIdleConnsPerHost: *concurrency * 2,
		IdleConnTimeout:     30 * time.Second,
	}
	client := &http.Client{Transport: tr, Timeout: 5 * time.Second}

	// Warm-up: discarded
	stopWarm := time.After(*warmup)
	doneWarm := make(chan struct{})
	go func() {
		<-stopWarm
		close(doneWarm)
	}()
	var wgWarm sync.WaitGroup
	for i := 0; i < *concurrency; i++ {
		wgWarm.Add(1)
		go func(id int) {
			defer wgWarm.Done()
			for {
				select {
				case <-doneWarm:
					return
				default:
				}
				doRequest(client, *method, *url, corpus[id%len(corpus)])
			}
		}(i)
	}
	wgWarm.Wait()

	// Real run
	var (
		ok       atomic.Uint64
		fail     atomic.Uint64
		bytesIn  atomic.Uint64
	)
	const sampleCap = 1 << 20
	samples := make([]int64, 0, sampleCap)
	var sMu sync.Mutex

	stop := time.After(*duration)
	doneRun := make(chan struct{})
	go func() {
		<-stop
		close(doneRun)
	}()

	t0 := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < *concurrency; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			local := make([]int64, 0, 4096)
			for {
				select {
				case <-doneRun:
					sMu.Lock()
					samples = append(samples, local...)
					sMu.Unlock()
					return
				default:
				}
				start := time.Now()
				n, err := doRequest(client, *method, *url, corpus[id%len(corpus)])
				lat := time.Since(start).Microseconds()
				if err != nil {
					fail.Add(1)
					continue
				}
				ok.Add(1)
				bytesIn.Add(uint64(n))
				if len(local) < cap(local) {
					local = append(local, lat)
				}
			}
		}(i)
	}
	wg.Wait()
	elapsed := time.Since(t0)

	// Stats
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	pct := func(p float64) int64 {
		if len(samples) == 0 {
			return 0
		}
		idx := int(float64(len(samples)) * p)
		if idx >= len(samples) {
			idx = len(samples) - 1
		}
		return samples[idx]
	}

	rps := float64(ok.Load()) / elapsed.Seconds()
	fmt.Printf("\n=== %s %s\n", *method, *url)
	fmt.Printf("concurrency = %d   duration = %s\n", *concurrency, elapsed.Round(time.Millisecond))
	fmt.Printf("ok = %d   fail = %d   bytes_in = %s\n",
		ok.Load(), fail.Load(), humanBytes(bytesIn.Load()))
	fmt.Printf("RPS = %.0f\n", rps)
	if len(samples) > 0 {
		fmt.Printf("latency µs:  p50=%d  p90=%d  p99=%d  max=%d  (n=%d)\n",
			pct(0.50), pct(0.90), pct(0.99), samples[len(samples)-1], len(samples))
	}
}

func doRequest(c *http.Client, method, url string, body []byte) (int, error) {
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	if method != http.MethodGet {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	n, _ := io.Copy(io.Discard, resp.Body)
	if resp.StatusCode >= 400 {
		return int(n), fmt.Errorf("status %d", resp.StatusCode)
	}
	return int(n), nil
}

func humanBytes(n uint64) string {
	const (
		_ = 1 << (10 * iota)
		K
		M
		G
	)
	switch {
	case n >= G:
		return fmt.Sprintf("%.2fG", float64(n)/G)
	case n >= M:
		return fmt.Sprintf("%.2fM", float64(n)/M)
	case n >= K:
		return fmt.Sprintf("%.2fK", float64(n)/K)
	}
	return fmt.Sprintf("%dB", n)
}
