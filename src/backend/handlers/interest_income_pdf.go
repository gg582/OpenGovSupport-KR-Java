package handlers

import (
	"fmt"
	"html"
	"net/http"
	"strings"

	"opengovsupport/backend/domain"
)

// ───── /pdf — 이자소득 출력본 ──────────────────────────

type interestPDFRow struct {
	Account  string  `json:"account"`
	Month    string  `json:"month"`
	Amount   float64 `json:"amount"`
	Deducted float64 `json:"deducted"`
}

type interestPDFReq struct {
	Title string                   `json:"title"`
	Rows  []map[string]interface{} `json:"rows"`
}

func handleInterestIncomePDF(w http.ResponseWriter, r *http.Request) {
	var req interestPDFReq
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "잘못된 요청 본문: "+err.Error())
		return
	}
	if len(req.Rows) == 0 {
		writeError(w, http.StatusBadRequest, "출력 데이터(rows)가 비어 있습니다.")
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "이자소득 공제 상담서"
	}

	rows := make([]interestPDFRow, 0, len(req.Rows))
	for _, raw := range req.Rows {
		rows = append(rows, interestPDFRow{
			Account:  domain.ToString(raw["account"]),
			Month:    domain.ToString(raw["month"]),
			Amount:   domain.ToFloat(raw["amount"]),
			Deducted: domain.ToFloat(raw["deducted"]),
		})
	}

	var totalAmount, totalDeducted float64
	for _, row := range rows {
		totalAmount += row.Amount
		totalDeducted += row.Deducted
	}

	var body strings.Builder
	body.WriteString(`<table>`)
	body.WriteString(`<thead><tr>` +
		`<th>계좌</th><th>월</th>` +
		`<th class="num">이자</th><th class="num">차감 후</th>` +
		`</tr></thead><tbody>`)
	for _, row := range rows {
		fmt.Fprintf(&body,
			`<tr><td>%s</td><td>%s</td>`+
				`<td class="num">%s</td><td class="num">%s</td></tr>`,
			html.EscapeString(row.Account),
			html.EscapeString(row.Month),
			html.EscapeString(domain.Won(row.Amount)),
			html.EscapeString(domain.Won(row.Deducted)),
		)
	}
	body.WriteString(`</tbody>`)
	fmt.Fprintf(&body,
		`<tfoot><tr><td colspan="2" class="total">합계</td>`+
			`<td class="num total">%s</td><td class="num total">%s</td></tr></tfoot>`,
		html.EscapeString(domain.Won(totalAmount)),
		html.EscapeString(domain.Won(totalDeducted)),
	)
	body.WriteString(`</table>`)

	doc := buildInterestPrintableHTML(title, body.String())

	summary := fmt.Sprintf("%s — 행 %d건, 이자합계 %s, 차감 후 합계 %s",
		title, len(rows), domain.Won(totalAmount), domain.Won(totalDeducted))

	writeJSON(w, http.StatusOK, Result{
		Title: title,
		Text:  summary,
		HTML:  doc,
		Data:  map[string]any{"rows": rows, "totalAmount": totalAmount, "totalDeducted": totalDeducted},
	})
}
