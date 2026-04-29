package handlers

import (
	"fmt"
	"math"
	"net/http"
	"strings"

	"opengovsupport/backend/domain"
)

// ───── /record — 이자소득 상담기록 ───────────────────────

type interestRecordRow struct {
	Account string  `json:"account"`
	Month   string  `json:"month"`
	Amount  float64 `json:"amount"`
}

type interestRecordReq struct {
	Category     string                   `json:"category"`
	DeductionCap float64                  `json:"deductionCap"`
	Rows         []map[string]interface{} `json:"rows"`
}

func handleInterestIncomeRecord(w http.ResponseWriter, r *http.Request) {
	var req interestRecordReq
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "잘못된 요청 본문: "+err.Error())
		return
	}
	if len(req.Rows) == 0 {
		writeError(w, http.StatusBadRequest, "이자 입력(rows)이 비어 있습니다.")
		return
	}
	if req.DeductionCap == 0 {
		if cap, ok := domain.InterestDeductionCap[req.Category]; ok {
			req.DeductionCap = float64(cap)
		}
	}

	rows := make([]interestRecordRow, 0, len(req.Rows))
	for _, raw := range req.Rows {
		rows = append(rows, interestRecordRow{
			Account: domain.ToString(raw["account"]),
			Month:   domain.ToString(raw["month"]),
			Amount:  domain.ToFloat(raw["amount"]),
		})
	}

	// Per-account totals + overall totals.
	type acctAgg struct {
		Account    string
		FirstMonth string
		LastMonth  string
		Months     int
		Amount     float64
	}
	order := []string{}
	byAccount := map[string]*acctAgg{}
	var totalE float64
	for _, row := range rows {
		totalE += row.Amount
		if row.Account == "" {
			continue
		}
		a, ok := byAccount[row.Account]
		if !ok {
			a = &acctAgg{Account: row.Account, FirstMonth: row.Month, LastMonth: row.Month}
			byAccount[row.Account] = a
			order = append(order, row.Account)
		}
		a.Months++
		a.Amount += row.Amount
		if row.Month != "" {
			if a.FirstMonth == "" || row.Month < a.FirstMonth {
				a.FirstMonth = row.Month
			}
			if row.Month > a.LastMonth {
				a.LastMonth = row.Month
			}
		}
	}

	// 추가공제 한도 = DeductionCap (항목별 법정 한도 또는 수동 보정값).
	totalExtraMonths := 0
	totalDeduction := 0.0
	limitCap := totalE - req.DeductionCap
	if limitCap < 0 {
		limitCap = 0
	}
	cumJ := 0
	cumK := 0.0
	type accRes struct {
		Account     string
		ExtraMonths int
		Deduction   float64
	}
	results := make([]accRes, 0, len(order))
	for _, name := range order {
		a := byAccount[name]
		extra := a.Months - 12
		if extra < 0 {
			extra = 0
		}
		cumJ += extra
		raw := float64(cumJ) * req.DeductionCap / 12.0
		ru := math.Ceil(raw)
		cumNow := math.Min(limitCap, ru)
		k := cumNow - cumK
		if k < 0 {
			k = 0
		}
		cumK += k
		totalExtraMonths += extra
		totalDeduction += k
		results = append(results, accRes{
			Account: name, ExtraMonths: extra, Deduction: k,
		})
	}

	var detail strings.Builder
	lastValidNo := ""
	zeroAll := math.Round(totalE) == math.Round(totalDeduction) && totalDeduction > 0
	for i, res := range results {
		a := byAccount[res.Account]
		prefix := ""
		if len(results) > 1 {
			prefix = fmt.Sprintf("%d. ", i+1)
		}
		isZero := res.Deduction == 0
		if isZero {
			if zeroAll {
				if lastValidNo != "" && len(results) > 1 {
					fmt.Fprintf(&detail, "  ※ %s번 추가공제금액으로 이자액총합 전부 공제됨\n", lastValidNo)
				} else {
					detail.WriteString("  ※ 추가공제금액으로 이자액총합 전부 공제됨\n")
				}
				break
			}
			overlap := "이전 기간에 포함됨"
			if lastValidNo != "" && len(results) > 1 {
				overlap = lastValidNo + "번 기간에 포함됨"
			}
			fmt.Fprintf(&detail, "  %s%s, 추가공제: 없음(%s)\n",
				prefix, res.Account, overlap)
			fmt.Fprintf(&detail, "     - 이자액: %s원, 가입년월: %s, 해지년월: %s\n",
				domain.FormatThousands(int64(a.Amount)), a.FirstMonth, a.LastMonth)
		} else {
			lastValidNo = fmt.Sprintf("%d", i+1)
			fmt.Fprintf(&detail, "  %s%s, 추가공제월수: %d개월, 추가공제금액: %s원\n",
				prefix, res.Account, res.ExtraMonths,
				domain.FormatThousands(int64(res.Deduction)))
			fmt.Fprintf(&detail, "     - 이자액: %s원, 가입년월: %s, 해지년월: %s\n",
				domain.FormatThousands(int64(a.Amount)), a.FirstMonth, a.LastMonth)
		}
	}

	var b strings.Builder
	b.WriteString("[이자소득 추가 공제 확인]\n")
	fmt.Fprintf(&b, "* 공제기준액 %s원\n", domain.FormatThousands(int64(req.DeductionCap)))
	fmt.Fprintf(&b, "* 이자총액 : %s원\n", domain.FormatThousands(int64(totalE)))
	fmt.Fprintf(&b, "* 추가공제월수 : %s개월\n", domain.FormatThousands(int64(totalExtraMonths)))
	fmt.Fprintf(&b, "* 총 추가공제금액 : %s원\n", domain.FormatThousands(int64(totalDeduction)))
	b.WriteString(detail.String())

	writeJSON(w, http.StatusOK, Result{
		Title: "이자소득 상담기록",
		Text:  strings.TrimRight(b.String(), "\n"),
		Data: map[string]any{
			"category":       req.Category,
			"deductionCap":   req.DeductionCap,
			"accounts":       order,
			"totalAmount":    totalE,
			"totalExtraMon":  totalExtraMonths,
			"totalDeduction": totalDeduction,
		},
	})
}
