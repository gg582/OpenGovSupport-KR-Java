package handlers

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"opengovsupport/backend/domain"
)

// ───── /record — 사적이전소득 상담기록 ───────────────────

type privateIncomeRecordRow struct {
	Household string  `json:"household"`
	Month     string  `json:"month"`
	Depositor string  `json:"depositor"`
	Amount    float64 `json:"amount"`
	Income    float64 `json:"income"`
}

type privateIncomeRecordReq struct {
	Rows []map[string]interface{} `json:"rows"`
}

func handlePrivateIncomeRecord(w http.ResponseWriter, r *http.Request) {
	var req privateIncomeRecordReq
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "잘못된 요청 본문: "+err.Error())
		return
	}
	if len(req.Rows) == 0 {
		writeError(w, http.StatusBadRequest, "계산 결과 행(rows)이 비어 있습니다.")
		return
	}

	rows := make([]privateIncomeRecordRow, 0, len(req.Rows))
	for _, raw := range req.Rows {
		rows = append(rows, privateIncomeRecordRow{
			Household: domain.ToString(raw["household"]),
			Month:     domain.ToString(raw["month"]),
			Depositor: domain.ToString(raw["depositor"]),
			Amount:    domain.ToFloat(raw["amount"]),
			Income:    domain.ToFloat(raw["income"]),
		})
	}

	// 입금자별 집계 — 누적 합계와 횟수 카운트.
	depositorOrder := []string{}
	depositorAmount := map[string]float64{}
	depositorCount := map[string]int{}
	householdLabel := ""
	monthsSet := map[string]struct{}{}
	for _, row := range rows {
		if row.Depositor != "" {
			if _, ok := depositorAmount[row.Depositor]; !ok {
				depositorOrder = append(depositorOrder, row.Depositor)
			}
			depositorAmount[row.Depositor] += row.Amount
			depositorCount[row.Depositor]++
		}
		if householdLabel == "" {
			householdLabel = row.Household
		}
		if row.Month != "" {
			monthsSet[row.Month] = struct{}{}
		}
	}

	var totalAmount, monthlyIncome float64
	for _, row := range rows {
		totalAmount += row.Amount
		monthlyIncome += row.Income
	}
	supportCount := 0
	for _, n := range depositorCount {
		supportCount += n
	}

	// "조사시작년월" approximated by the smallest month string when present.
	months := make([]string, 0, len(monthsSet))
	for m := range monthsSet {
		months = append(months, m)
	}
	sort.Strings(months)
	startMonth := ""
	if len(months) > 0 {
		startMonth = months[0]
	}

	var b strings.Builder
	b.WriteString("* 사적이전소득 조사 결과\n")
	fmt.Fprintf(&b, "* 조사시작년월 : %s, * 가구원수 : %s인\n", startMonth, householdLabel)

	depositorParts := make([]string, 0, len(depositorOrder))
	for _, name := range depositorOrder {
		depositorParts = append(depositorParts,
			fmt.Sprintf("입금자 %s, %s원", name, domain.FormatThousands(int64(depositorAmount[name]))),
		)
	}
	if len(depositorParts) > 0 {
		fmt.Fprintf(&b, "* %s\n", strings.Join(depositorParts, ", "))
	}
	fmt.Fprintf(&b, "* 총 산출금액 %s원, 지원횟수 %d회\n",
		domain.FormatThousands(int64(totalAmount)), supportCount)
	fmt.Fprintf(&b, "* 월 사적이전소득 반영금액 %s원",
		domain.FormatThousands(int64(monthlyIncome)))

	writeJSON(w, http.StatusOK, Result{
		Title: "사적이전소득 상담기록",
		Text:  b.String(),
		Data: map[string]any{
			"depositors":    depositorOrder,
			"totalAmount":   totalAmount,
			"supportCount":  supportCount,
			"monthlyIncome": monthlyIncome,
		},
	})
}
