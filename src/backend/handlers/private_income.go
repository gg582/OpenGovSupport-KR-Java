package handlers

import (
	"html"
	"net/http"
)

// registerPrivateIncome wires the three 사적이전소득 endpoints (계산 / 상담기록 / PDF).
func registerPrivateIncome(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/private-income/calc", handlePrivateIncomeCalc)
	mux.HandleFunc("POST /api/private-income/record", handlePrivateIncomeRecord)
	mux.HandleFunc("POST /api/private-income/pdf", handlePrivateIncomePDF)
}

// buildPrintableHTML wraps a table fragment in an A4-portrait print stylesheet.
// The frontend opens the returned string in a new tab; the user prints to PDF.
func buildPrintableHTML(title, body string) string {
	return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>` + html.EscapeString(title) + `</title>
<style>
@page { size: A4 portrait; margin: 18mm 14mm; }
body { font-family: "Noto Sans KR", "Malgun Gothic", sans-serif; color:#111; margin:0; padding:24px; }
h1 { font-size: 18pt; margin: 0 0 16px; }
table { width:100%; border-collapse: collapse; font-size: 11pt; }
th, td { border:1px solid #888; padding:6px 8px; text-align:left; }
th { background:#f3efe3; }
td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }
.total { font-weight:bold; background:#fdf6df; }
@media print { body { padding:0; } button.print { display:none; } }
button.print { float:right; padding:6px 14px; }
</style></head>
<body>
<button class="print" onclick="window.print()">인쇄 / PDF 저장</button>
<h1>` + html.EscapeString(title) + `</h1>
` + body + `
</body></html>`
}
