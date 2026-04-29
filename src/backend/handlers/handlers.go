package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
)

var osGetenv = os.Getenv

// Result is the unified shape returned by every feature endpoint.
// The frontend renders the same way regardless of feature.
type Result struct {
	Title string         `json:"title"`           // human title for the result panel
	Text  string         `json:"text"`            // clipboard-friendly plain text
	Data  map[string]any `json:"data,omitempty"`  // structured numbers/tables
	HTML  string         `json:"html,omitempty"`  // optional pre-rendered HTML (PDF preview etc.)
	Notes []string       `json:"notes,omitempty"` // soft warnings
}

// Register wires every feature endpoint onto the mux.
func Register(mux *http.ServeMux) {
	registerPrivateIncome(mux)
	registerInterestIncome(mux)
	registerProperty(mux)
	registerInheritance(mux)
	registerEmergency(mux)
	registerOverseas(mux)
	registerShared(mux)
	registerEvents(mux)
}

// ───── helpers ─────

// jsonBufPool reuses encode buffers across requests. Compact JSON is used —
// no indentation — which roughly halves the bytes written and the work the
// encoder does. The dev-friendly indented form is enabled by JSON_INDENT=1.
var jsonBufPool = sync.Pool{
	New: func() any { return bytes.NewBuffer(make([]byte, 0, 1024)) },
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	buf := jsonBufPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer jsonBufPool.Put(buf)

	enc := json.NewEncoder(buf)
	if jsonIndent {
		enc.SetIndent("", "  ")
	}
	if err := enc.Encode(v); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))
	w.WriteHeader(status)
	_, _ = w.Write(buf.Bytes())
}

// jsonIndent toggles indented output. Set JSON_INDENT=1 in dev for readability.
var jsonIndent = func() bool {
	v := strings.TrimSpace(osGetenv("JSON_INDENT"))
	return v == "1" || v == "true"
}()

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// decodeBody reads the request body and decodes it into `into`.
// To accommodate the frontend (which posts every form field as a string,
// even numeric ones), this first decodes into a generic map and converts
// string-encoded numbers to actual numbers before re-marshaling into the
// target struct. Empty strings for numeric fields become 0.
func decodeBody(r *http.Request, into any) error {
	var raw any
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		return err
	}
	raw = relaxNumbers(raw)
	buf, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(buf, into)
}

// relaxNumbers recursively walks v; any string that parses as a JSON number
// is rewritten as a float64 so that target structs with float64 fields decode.
func relaxNumbers(v any) any {
	switch x := v.(type) {
	case map[string]any:
		for k, vv := range x {
			x[k] = relaxNumbers(vv)
		}
		return x
	case []any:
		for i, vv := range x {
			x[i] = relaxNumbers(vv)
		}
		return x
	case string:
		t := strings.TrimSpace(x)
		if t == "" {
			return x
		}
		// strip thousands separators, e.g. "1,500,000"
		c := strings.ReplaceAll(t, ",", "")
		if f, err := strconv.ParseFloat(c, 64); err == nil {
			// Only auto-convert if the original looked like a plain number.
			// This avoids accidentally rewriting strings like "1." labels.
			if isLikelyNumber(c) {
				return f
			}
		}
		return x
	default:
		return v
	}
}

func isLikelyNumber(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		switch {
		case r >= '0' && r <= '9':
		case r == '.' || r == '-' || r == '+':
			if i > 0 && (r == '-' || r == '+') {
				return false
			}
		default:
			return false
		}
	}
	return true
}
