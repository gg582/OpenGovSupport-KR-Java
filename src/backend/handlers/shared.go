package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"opengovsupport/backend/domain"
)

// 99_공용 — 공용 유틸 (개월수계산 / 초기 차감금액 계산).

func registerShared(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/shared/months", handleSharedMonths)
	mux.HandleFunc("POST /api/shared/initial-deduction", handleSharedInitialDeduction)
}

type sharedMonthsBody struct {
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
}

func handleSharedMonths(w http.ResponseWriter, r *http.Request) {
	var b sharedMonthsBody
	if err := decodeBody(r, &b); err != nil {
		writeError(w, http.StatusBadRequest, "요청을 해석하지 못했습니다: "+err.Error())
		return
	}
	start, err := domain.ParseDate(b.StartDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "시작일이 올바른 날짜가 아닙니다.")
		return
	}
	end, err := domain.ParseDate(b.EndDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "종료일이 올바른 날짜가 아닙니다.")
		return
	}
	months := domain.MonthsBetween(start, end)
	writeJSON(w, http.StatusOK, Result{
		Title: "개월수 계산 결과",
		Text:  fmt.Sprintf("%s ~ %s : %d개월", domain.FormatKDate(start), domain.FormatKDate(end), months),
		Data:  map[string]any{"months": months},
	})
}

type sharedInitialBody struct {
	Category     string  `json:"category"`
	BaselineDate string  `json:"baselineDate"`
	CurrentDate  string  `json:"currentDate"`
	Principal    float64 `json:"principal"`
}

// handleSharedInitialDeduction implements 초기차감금액계산.
// For each year between baselineDate and currentDate, multiply the year-specific
// table value by the months elapsed in that year and sum.
//
//   - 항목 = "기타증여재산" → 표값은 비율(0.5). 누적 = principal × 0.5 × months
//   - 항목 = "맞춤형 N인" / "기초연금 N인" → 표값은 월 기준액(원). 누적 = 기준액 × months
func handleSharedInitialDeduction(w http.ResponseWriter, r *http.Request) {
	var b sharedInitialBody
	if err := decodeBody(r, &b); err != nil {
		writeError(w, http.StatusBadRequest, "요청을 해석하지 못했습니다: "+err.Error())
		return
	}
	baseline, err := domain.ParseDate(b.BaselineDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "기준일이 올바른 날짜가 아닙니다.")
		return
	}
	current, err := domain.ParseDate(b.CurrentDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "조사일이 올바른 날짜가 아닙니다.")
		return
	}

	startY, endY := baseline.Year(), current.Year()
	if endY < startY {
		writeError(w, http.StatusBadRequest, "조사일이 기준일보다 빠릅니다.")
		return
	}

	type yearBreak struct {
		Year   int     `json:"year"`
		Months int     `json:"months"`
		Value  float64 `json:"value"`
		Sub    float64 `json:"amount"`
	}
	var breakdown []yearBreak
	var totalMonths int
	var total float64

	for y := startY; y <= endY; y++ {
		months := monthsInYear(y, baseline, current)
		val, kind := lookupCategory(b.Category, y)
		var sub float64
		switch kind {
		case "rate":
			sub = b.Principal * val * float64(months)
		case "amount":
			sub = val * float64(months)
		}
		breakdown = append(breakdown, yearBreak{Year: y, Months: months, Value: val, Sub: sub})
		totalMonths += months
		total += sub
	}

	writeJSON(w, http.StatusOK, Result{
		Title: "초기 차감 금액",
		Text: fmt.Sprintf(
			"기준일 %s ~ 조사일 %s\n* 항목 : %s\n* 누적 개월수 : %d개월\n* 누적 차감액 : %s",
			domain.FormatKDate(baseline), domain.FormatKDate(current), b.Category, totalMonths, domain.Won(total),
		),
		Data: map[string]any{
			"category":  b.Category,
			"months":    totalMonths,
			"deduction": total,
			"principal": b.Principal,
			"breakdown": breakdown,
		},
	})
}

func monthsInYear(year int, baseline, current time.Time) int {
	bY, cY := baseline.Year(), current.Year()
	bM, cM := int(baseline.Month()), int(current.Month())
	switch {
	case year == bY && year == cY:
		return cM - bM + 1
	case year == bY:
		return 12 - bM + 1
	case year == cY:
		return cM
	default:
		return 12
	}
}

// lookupCategory returns (value, kind) for the standards table.
//   - "rate"   → multiply against principal × months.
//   - "amount" → multiply against months alone (already in 원).
//   - ""       → unknown category, contributes nothing.
func lookupCategory(category string, year int) (float64, string) {
	if category == "기타증여재산" {
		if r, ok := domain.OtherGiftRate[year]; ok {
			return r, "rate"
		}
		return 0, ""
	}
	if n := parseHouseholdSuffix(category, "맞춤형 "); n > 0 {
		if a, ok := domain.CustomBaseAmount[year][n]; ok {
			return float64(a), "amount"
		}
	}
	if n := parseHouseholdSuffix(category, "기초연금 "); n > 0 {
		if a, ok := domain.CustomBaseAmount[year][n]; ok {
			return float64(a), "amount"
		}
	}
	return 0, ""
}

// parseHouseholdSuffix("맞춤형 4인", "맞춤형 ") → 4. Returns 0 on no match.
func parseHouseholdSuffix(s, prefix string) int {
	if len(s) <= len(prefix) || s[:len(prefix)] != prefix {
		return 0
	}
	rest := s[len(prefix):]
	const tail = "인"
	if len(rest) <= len(tail) || rest[len(rest)-len(tail):] != tail {
		return 0
	}
	num := rest[:len(rest)-len(tail)]
	n := 0
	for _, c := range num {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// decodeAny is a relaxed body decoder used by handlers whose inputs may arrive
// either as numbers or as strings (the frontend sends form values as strings).
func decodeAny(r *http.Request) (map[string]any, error) {
	out := map[string]any{}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}
