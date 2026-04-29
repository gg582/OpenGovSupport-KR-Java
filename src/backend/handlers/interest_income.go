package handlers

import (
	"fmt"
	"html"
	"net/http"
	"strings"

	"opengovsupport/backend/domain"
)

// registerInterestIncome wires the 이자소득 endpoints (계산 / 상담기록 / PDF).
func registerInterestIncome(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/interest-income/calc", handleInterestIncomeCalc)
	mux.HandleFunc("POST /api/interest-income/record", handleInterestIncomeRecord)
	mux.HandleFunc("POST /api/interest-income/pdf", handleInterestIncomePDF)
}

// parseYearMonth accepts "YYYY-MM", "YYYY/MM", "YYYY.MM", "YYYY-MM-DD", "YYYYMM".
func parseYearMonth(s string) (year, month int, ok bool) {
	s = strings.TrimSpace(s)
	if len(s) < 6 {
		return 0, 0, false
	}
	// fast path for the common 4 + sep + 2 form.
	if len(s) >= 7 && (s[4] == '-' || s[4] == '/' || s[4] == '.') {
		y, m := 0, 0
		fmt.Sscanf(s[:4], "%d", &y)
		fmt.Sscanf(s[5:7], "%d", &m)
		if y > 0 && m >= 1 && m <= 12 {
			return y, m, true
		}
	}
	// 6-digit YYYYMM form.
	if len(s) == 6 {
		y, m := 0, 0
		fmt.Sscanf(s[:4], "%d", &y)
		fmt.Sscanf(s[4:6], "%d", &m)
		if y > 0 && m >= 1 && m <= 12 {
			return y, m, true
		}
	}
	// Try ParseDate as a fallback (YYYY-MM-DD etc.).
	if t, err := domain.ParseDate(s); err == nil {
		return t.Year(), int(t.Month()), true
	}
	return 0, 0, false
}

// buildInterestPrintableHTML wraps a table fragment in an A4-portrait print
// stylesheet with a slightly different header palette than the 사적이전소득 PDF.
func buildInterestPrintableHTML(title, body string) string {
	return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>` + html.EscapeString(title) + `</title>
<style>
@page { size: A4 portrait; margin: 18mm 14mm; }
body { font-family: "Noto Sans KR", "Malgun Gothic", sans-serif; color:#111; margin:0; padding:24px; }
h1 { font-size: 18pt; margin: 0 0 16px; }
table { width:100%; border-collapse: collapse; font-size: 11pt; }
th, td { border:1px solid #888; padding:6px 8px; text-align:left; }
th { background:#eef3f8; }
td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }
.total { font-weight:bold; background:#dfe9f5; }
@media print { body { padding:0; } button.print { display:none; } }
button.print { float:right; padding:6px 14px; }
</style></head>
<body>
<button class="print" onclick="window.print()">인쇄 / PDF 저장</button>
<h1>` + html.EscapeString(title) + `</h1>
` + body + `
</body></html>`
}
