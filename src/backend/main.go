package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"opengovsupport/backend/domain"
	"opengovsupport/backend/handlers"
	bruntime "opengovsupport/backend/runtime"
)

func main() {
	if old, applied := bruntime.ConfigureGC(); applied {
		log.Printf("GOGC adjusted from %d (default 100)", old)
	}

	mux := http.NewServeMux()

	pool := bruntime.NewPool()
	coalescer := bruntime.NewCoalescer()

	mux.HandleFunc("GET /api/features", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, domain.AllFeatures())
	})
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/runtime/stats", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"pool":      pool.Snapshot(),
			"coalescer": coalescer.Snapshot(),
		})
	})

	handlers.Register(mux)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Outer-to-inner middleware order:
	//   CORS  →  logging  →  bounded worker pool  →  request coalescer  →  mux
	// The coalescer sits *inside* the pool: identical concurrent requests
	// share a worker, multiplying effective throughput on hot paths.
	handler := withCORS(withLogging(pool.Middleware(coalescer.Middleware(mux))))

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("backend listening on :%s (workers=%d)", port, pool.Snapshot().Workers)
	log.Fatal(srv.ListenAndServe())
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(start))
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}
