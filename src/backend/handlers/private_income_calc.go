package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"opengovsupport/backend/domain"
)

// ───── /calc — 사적이전소득 계산 ─────────────────────────

type privateIncomeCalcReq struct {
	Year             int                      `json:"year"`
	Household        int                      `json:"household"`
	AltLabel         string                   `json:"altLabel"`
	ThresholdGeneral float64                  `json:"thresholdGeneral"`
	ThresholdAlt     float64                  `json:"thresholdAlt"`
	Rows             []map[string]interface{} `json:"rows"`
}

// privateCalcRow is one input row enriched with the per-depositor totals
// (G column) and the post-threshold residual (H column).
type privateCalcRow struct {
	Household string  `json:"household"`
	Month     string  `json:"month"`
	Depositor string  `json:"depositor"`
	Amount    float64 `json:"amount"`
	Exclude   float64 `json:"exclude"`
	G         float64 `json:"g"`     // 입금자 단위 (E - F) — 첫 출현 행만 채움
	GShown    bool    `json:"gShown"`
	H         float64 `json:"h"`     // G - 기준값 (음수면 0)
	HShown    bool    `json:"hShown"`
}

func handlePrivateIncomeCalc(w http.ResponseWriter, r *http.Request) {
	var req privateIncomeCalcReq
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "잘못된 요청 본문: "+err.Error())
		return
	}
	if len(req.Rows) == 0 {
		writeError(w, http.StatusBadRequest, "입력 데이터(rows)가 비어 있습니다.")
		return
	}
	if req.Year == 0 {
		req.Year = domain.CurrentYear()
	}
	if req.Household < 1 {
		req.Household = 1
	}
	// 법령 기본값: 일반 = 중위소득 50%, 특수 = 중위소득 15%.
	if req.ThresholdGeneral == 0 {
		req.ThresholdGeneral = float64(domain.PrivateIncomeMonthly(req.Year, req.Household))
	}
	if req.ThresholdAlt == 0 {
		req.ThresholdAlt = float64(domain.PrivateIncomeAlt(req.Year, req.Household))
	}

	rows := make([]privateCalcRow, 0, len(req.Rows))
	for _, raw := range req.Rows {
		rows = append(rows, privateCalcRow{
			Household: domain.ToString(raw["household"]),
			Month:     domain.ToString(raw["month"]),
			Depositor: domain.ToString(raw["depositor"]),
			Amount:    domain.ToFloat(raw["amount"]),
			Exclude:   domain.ToFloat(raw["exclude"]),
		})
	}

	// G열: per-depositor (D열) totals — only first occurrence shows the value,
	// and only when SUM(E) - SUM(F) > 0.
	totalsByDepositor := map[string]float64{}
	for _, row := range rows {
		totalsByDepositor[row.Depositor] += row.Amount - row.Exclude
	}
	seenDepositor := map[string]bool{}
	for i := range rows {
		d := rows[i].Depositor
		if d == "" {
			continue
		}
		if seenDepositor[d] {
			continue
		}
		seenDepositor[d] = true
		total := totalsByDepositor[d]
		if total > 0 {
			rows[i].G = total
			rows[i].GShown = true

			threshold := req.ThresholdGeneral
			if req.AltLabel != "" && rows[i].Household == req.AltLabel {
				threshold = req.ThresholdAlt
			}
			diff := total - threshold
			if diff <= 0 {
				rows[i].H = 0
			} else {
				rows[i].H = diff
			}
			rows[i].HShown = true
		}
	}

	// Per-depositor summary block (mirrors the K3:.. result table).
	type depositorTotal struct {
		Name   string  `json:"name"`
		Amount float64 `json:"amount"`
		Count  int     `json:"count"`
	}
	depositorOrder := []string{}
	depositorCount := map[string]int{}
	for _, row := range rows {
		if row.Depositor == "" {
			continue
		}
		if _, ok := depositorCount[row.Depositor]; !ok {
			depositorOrder = append(depositorOrder, row.Depositor)
		}
		depositorCount[row.Depositor]++
	}
	totals := make([]depositorTotal, 0, len(depositorOrder))
	for _, name := range depositorOrder {
		totals = append(totals, depositorTotal{
			Name:   name,
			Amount: totalsByDepositor[name],
			Count:  depositorCount[name],
		})
	}

	var totalAmount float64
	var supportCount int
	var monthlyIncome float64
	for _, row := range rows {
		if row.GShown {
			totalAmount += row.G
		}
		if row.HShown {
			monthlyIncome += row.H
		}
	}
	for _, t := range totals {
		if t.Amount > 0 {
			supportCount += t.Count
		}
	}

	var b strings.Builder
	b.WriteString("* 사적이전소득 계산 결과\n")
	for _, row := range rows {
		if !row.GShown {
			continue
		}
		fmt.Fprintf(&b,
			"  - %s, %s, %s, 입금 %s, 산출 %s\n",
			row.Household, row.Month, row.Depositor,
			domain.Won(row.Amount-row.Exclude), domain.Won(row.G),
		)
	}
	fmt.Fprintf(&b, "* 총 산출금액 %s, 지원횟수 %d회\n",
		domain.Won(totalAmount), supportCount)
	fmt.Fprintf(&b, "* 월 사적이전소득 반영금액 %s", domain.Won(monthlyIncome))

	writeJSON(w, http.StatusOK, Result{
		Title: "사적이전소득 계산",
		Text:  b.String(),
		Data: map[string]any{
			"year":             req.Year,
			"household":        req.Household,
			"thresholdGeneral": req.ThresholdGeneral,
			"thresholdAlt":     req.ThresholdAlt,
			"rows":             rows,
			"depositors":       totals,
			"totalAmount":      totalAmount,
			"supportCount":     supportCount,
			"monthlyIncome":    monthlyIncome,
		},
	})
}
