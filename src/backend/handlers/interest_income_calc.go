package handlers

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"

	"opengovsupport/backend/domain"
)

// ───── /calc — 이자소득 추가공제 계산 ─────────────────────────────

type interestCalcReq struct {
	Category     string                   `json:"category"`     // 맞춤형 / 기초연금 / 타법
	DeductionCap float64                  `json:"deductionCap"` // 수동 보정값 (0이면 항목별 법정 한도 적용)
	Rows         []map[string]interface{} `json:"rows"`
}

// interestCalcRow is one input row enriched with H/I/J/K computed values.
type interestCalcRow struct {
	Seq           int     `json:"seq"`        // B열 연번
	Account       string  `json:"account"`    // D열 계좌
	StartMonth    string  `json:"startMonth"` // F열 시작연월 (YYYY-MM)
	EndMonth      string  `json:"endMonth"`   // G열 종료연월 (YYYY-MM)
	Amount        float64 `json:"amount"`     // E열 이자액
	EffStartMonth string  `json:"effStartMonth"` // H열 - 보정 시작월
	Months        int     `json:"months"`        // I열 가입월수
	ExtraMonths   int     `json:"extraMonths"`   // J열 추가공제개월수
	Deduction     float64 `json:"deduction"`     // K열 추가공제금액
}

func handleInterestIncomeCalc(w http.ResponseWriter, r *http.Request) {
	var req interestCalcReq
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

	// 1) Normalize.
	rows := make([]interestCalcRow, 0, len(req.Rows))
	for _, raw := range req.Rows {
		rows = append(rows, interestCalcRow{
			Account:    domain.ToString(raw["account"]),
			StartMonth: strings.TrimSpace(domain.ToString(raw["startMonth"])),
			EndMonth:   strings.TrimSpace(domain.ToString(raw["endMonth"])),
			Amount:     domain.ToFloat(raw["amount"]),
		})
	}

	// 2) Sort by (계좌, 시작연월, 종료연월).
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Account != rows[j].Account {
			return rows[i].Account < rows[j].Account
		}
		if rows[i].StartMonth != rows[j].StartMonth {
			return rows[i].StartMonth < rows[j].StartMonth
		}
		return rows[i].EndMonth < rows[j].EndMonth
	})

	// 3) Assign 연번 (B열) starting at 1.
	for i := range rows {
		rows[i].Seq = i + 1
	}

	// 4) H열: max(F[i], maxEnd[0..i-1] + 1 month) — across all rows regardless of account.
	//    I열: 가입월수 = months between F and G inclusive.
	//    J열: max(0, I - 12) but using the H-adjusted start when applicable.
	maxEnd := -1 // months since epoch (0001-01) for the maximum prior G
	for i := range rows {
		startY, startM, ok1 := parseYearMonth(rows[i].StartMonth)
		endY, endM, ok2 := parseYearMonth(rows[i].EndMonth)
		if !ok1 || !ok2 {
			continue
		}
		startIdx := startY*12 + (startM - 1)
		endIdx := endY*12 + (endM - 1)

		// I열: DATEDIF(F, EDATE(G,1), "m") — months between start and (end+1), inclusive end.
		months := endIdx + 1 - startIdx
		if months < 0 {
			months = 0
		}
		rows[i].Months = months

		// H열 effective start = MAX(시작연월, 직전 행 종료연월 + 1).
		effIdx := startIdx
		if i > 0 && maxEnd >= 0 && maxEnd+1 > effIdx {
			effIdx = maxEnd + 1
		}
		ey, em := effIdx/12, (effIdx%12)+1
		rows[i].EffStartMonth = fmt.Sprintf("%04d-%02d", ey, em)

		// J열 추가공제개월수.
		//  - 첫 행: MAX(0, 가입월수 - 12)
		//  - 그 다음 행: 보정 시작월이 종료월보다 뒤면 0, 아니면 종료월 - 보정 시작월 + 1.
		var extra int
		if i == 0 {
			extra = months - 12
			if extra < 0 {
				extra = 0
			}
		} else {
			if effIdx > endIdx {
				extra = 0
			} else {
				extra = endIdx + 1 - effIdx
			}
		}
		rows[i].ExtraMonths = extra

		if endIdx > maxEnd {
			maxEnd = endIdx
		}
	}

	// 5) K열 per-row 추가공제금액.
	//    한도 = MAX(0, 이자총액 - 공제기준액)
	//    cumNow(i) = MIN(한도, ROUNDUP(누적 J[0..i] × 공제기준액 / 12))
	//    K(0) = cumNow(0); K(i) = cumNow(i) - 누적 K[0..i-1].
	var totalE float64
	for _, row := range rows {
		totalE += row.Amount
	}
	limitCap := totalE - req.DeductionCap
	if limitCap < 0 {
		limitCap = 0
	}
	cumJ := 0
	cumK := 0.0
	for i := range rows {
		cumJ += rows[i].ExtraMonths
		raw := float64(cumJ) * req.DeductionCap / 12.0
		ru := math.Ceil(raw) // ROUNDUP to whole 원
		cumNow := math.Min(limitCap, ru)
		k := cumNow - cumK
		if k < 0 {
			k = 0
		}
		rows[i].Deduction = k
		cumK += k
	}

	// 6) Aggregate totals.
	var totalJ int
	var totalK float64
	for _, row := range rows {
		totalJ += row.ExtraMonths
		totalK += row.Deduction
	}

	// 7) Compose clipboard summary text.
	var b strings.Builder
	b.WriteString("[이자소득 추가 공제 계산]\n")
	fmt.Fprintf(&b, "* 공제기준액 %s원\n", domain.FormatThousands(int64(req.DeductionCap)))
	fmt.Fprintf(&b, "* 이자총액 : %s원\n", domain.FormatThousands(int64(totalE)))
	fmt.Fprintf(&b, "* 추가공제월수 : %s개월\n", domain.FormatThousands(int64(totalJ)))
	fmt.Fprintf(&b, "* 총 추가공제금액 : %s원", domain.FormatThousands(int64(totalK)))

	writeJSON(w, http.StatusOK, Result{
		Title: "이자소득 추가 공제 계산",
		Text:  b.String(),
		Data: map[string]any{
			"category":       req.Category,
			"deductionCap":   req.DeductionCap,
			"rows":           rows,
			"totalAmount":    totalE,
			"totalExtraMon":  totalJ,
			"totalDeduction": totalK,
		},
	})
}
