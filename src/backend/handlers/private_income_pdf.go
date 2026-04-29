package handlers

import (
	"fmt"
	"html"
	"net/http"
	"strings"

	"opengovsupport/backend/domain"
)

// ───── /pdf — 사적이전소득 출력본 ──────────────────────

type privateIncomePDFRow struct {
	Household string  `json:"household"`
	Month     string  `json:"month"`
	Depositor string  `json:"depositor"`
	Amount    float64 `json:"amount"`
	Income    float64 `json:"income"`
}

type privateIncomePDFReq struct {
	Title string                   `json:"title"`
	Rows  []map[string]interface{} `json:"rows"`
}

func handlePrivateIncomePDF(w http.ResponseWriter, r *http.Request) {
	var req privateIncomePDFReq
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
		title = "사적이전소득 계산서"
	}

	rows := make([]privateIncomePDFRow, 0, len(req.Rows))
	for _, raw := range req.Rows {
		rows = append(rows, privateIncomePDFRow{
			Household: domain.ToString(raw["household"]),
			Month:     domain.ToString(raw["month"]),
			Depositor: domain.ToString(raw["depositor"]),
			Amount:    domain.ToFloat(raw["amount"]),
			Income:    domain.ToFloat(raw["income"]),
		})
	}

	var totalAmount, totalIncome float64
	for _, row := range rows {
		totalAmount += row.Amount
		totalIncome += row.Income
	}

	// Render printable HTML — A4 portrait, simple table with the same columns as input.
	var body strings.Builder
	body.WriteString(`<table>`)
	body.WriteString(`<thead><tr>` +
		`<th>가구구분</th><th>입금월</th><th>입금자</th>` +
		`<th class="num">입금액</th><th class="num">사적이전소득</th>` +
		`</tr></thead><tbody>`)
	for _, row := range rows {
		fmt.Fprintf(&body,
			`<tr><td>%s</td><td>%s</td><td>%s</td>`+
				`<td class="num">%s</td><td class="num">%s</td></tr>`,
			html.EscapeString(row.Household),
			html.EscapeString(row.Month),
			html.EscapeString(row.Depositor),
			html.EscapeString(domain.Won(row.Amount)),
			html.EscapeString(domain.Won(row.Income)),
		)
	}
	body.WriteString(`</tbody>`)
	fmt.Fprintf(&body,
		`<tfoot><tr><td colspan="3" class="total">합계</td>`+
			`<td class="num total">%s</td><td class="num total">%s</td></tr></tfoot>`,
		html.EscapeString(domain.Won(totalAmount)),
		html.EscapeString(domain.Won(totalIncome)),
	)
	body.WriteString(`</table>`)

	doc := buildPrintableHTML(title, body.String())

	summary := fmt.Sprintf("%s — 행 %d건, 입금합계 %s, 사적이전소득 %s",
		title, len(rows), domain.Won(totalAmount), domain.Won(totalIncome))

	writeJSON(w, http.StatusOK, Result{
		Title: title,
		Text:  summary,
		HTML:  doc,
		Data:  map[string]any{"rows": rows, "totalAmount": totalAmount, "totalIncome": totalIncome},
	})
}
