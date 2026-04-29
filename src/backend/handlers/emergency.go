package handlers

import (
	"fmt"
	"math"
	"net/http"
	"time"

	"opengovsupport/backend/domain"
)

// registerEmergency wires POST /api/emergency/explain onto the mux.
// The handler builds a per-month period table and a deduction schedule for
// emergency-aid recipients.
func registerEmergency(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/emergency/explain", handleEmergencyExplain)
}

type emergencyRequest struct {
	Year           int     `json:"year"`
	StartDate      string  `json:"startDate"`
	EndDate        string  `json:"endDate"`
	HouseholdSize  float64 `json:"householdSize"`
	MonthlyAmount  float64 `json:"monthlyAmount"`
	IncomeBaseline float64 `json:"incomeBaseline"`
	DeductionRate  float64 `json:"deductionRate"`
}

// periodRow captures one row of the period table (year + start/end month-day)
// alongside the derived columns (days-in-month, applied days, daily amount,
// applied amount, payable amount).
type periodRow struct {
	Year         int     `json:"year"`
	StartMonth   int     `json:"startMonth"`
	StartDay     int     `json:"startDay"`
	EndMonth     int     `json:"endMonth"`
	EndDay       int     `json:"endDay"`
	EmergencyAmt float64 `json:"emergencyAmount"` // E
	BaseAmount   float64 `json:"baseAmount"`      // F = round(income*rate) - adj
	DaysInMonth  int     `json:"daysInMonth"`     // L
	AppliedDays  int     `json:"appliedDays"`     // M = end-start+1
	DailyAmount  float64 `json:"dailyAmount"`     // N = E/L
	AppliedAmt   float64 `json:"appliedAmount"`   // O = round(N*M)
	Payable      float64 `json:"payable"`         // P = min(F, O)
}

// scheduleRow is the merged R:T deduction-summary structure (월별 공제/지급).
type scheduleRow struct {
	Label     string  `json:"label"`     // "5월", "첫지급 7월 지급액", "다음달 8월 지급액", "총합"
	Deduction float64 `json:"deduction"` // S
	Payment   float64 `json:"payment"`   // T
}

func handleEmergencyExplain(w http.ResponseWriter, r *http.Request) {
	raw, err := decodeAny(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	req := emergencyRequest{
		Year:           int(domain.ToFloat(raw["year"])),
		StartDate:      domain.ToString(raw["startDate"]),
		EndDate:        domain.ToString(raw["endDate"]),
		HouseholdSize:  domain.ToFloat(raw["householdSize"]),
		MonthlyAmount:  domain.ToFloat(raw["monthlyAmount"]),
		IncomeBaseline: domain.ToFloat(raw["incomeBaseline"]),
		DeductionRate:  domain.ToFloat(raw["deductionRate"]),
	}
	if req.Year == 0 {
		req.Year = domain.CurrentYear()
	}
	if req.IncomeBaseline == 0 {
		if mi, ok := domain.MedianIncome[req.Year][int(req.HouseholdSize)]; ok {
			req.IncomeBaseline = float64(mi)
		}
	}
	if req.DeductionRate == 0 {
		if r, ok := domain.LivingBenefitRate[req.Year]; ok {
			req.DeductionRate = r
		}
	}

	dStart, err := domain.ParseDate(req.StartDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "시작일에 올바른 날짜를 먼저 입력하세요.")
		return
	}
	dEnd, err := domain.ParseDate(req.EndDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "종료일에 올바른 날짜를 먼저 입력하세요.")
		return
	}
	if dEnd.Before(dStart) {
		writeError(w, http.StatusBadRequest, "종료일이 시작일보다 빠릅니다.")
		return
	}

	rows := buildPeriodTable(dStart, dEnd)
	annotateBaseAndEmergency(rows, req)
	annotateDaysAndPayable(rows)

	schedule := buildDeductionSchedule(rows, dStart, req)
	narrative := buildNarrative(rows, schedule, dStart, dEnd, req)

	res := Result{
		Title: "긴급 공제 설명",
		Text:  narrative,
		Data: map[string]any{
			"year":               req.Year,
			"periodTable":        rows,
			"deductionSchedule":  schedule,
			"startDate":          domain.FormatKDate(dStart),
			"endDate":            domain.FormatKDate(dEnd),
			"householdSize":      req.HouseholdSize,
			"monthlyAmount":      req.MonthlyAmount,
			"incomeBaseline":     req.IncomeBaseline,
			"deductionRate":      req.DeductionRate,
			"computedBaseAmount": computeBaseAmount(req),
		},
	}
	writeJSON(w, http.StatusOK, res)
}

// ─────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────

func lastDayOfMonth(year, month int) int {
	// Day 0 of next month == last day of given month.
	t := time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC)
	return t.Day()
}

// roundUpToTen rounds away from zero to the next multiple of 10.
func roundUpToTen(x float64) float64 {
	if x == 0 {
		return 0
	}
	if x > 0 {
		return math.Ceil(x/10) * 10
	}
	return math.Floor(x/10) * 10
}

func maxDate(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func scheduleLookup(schedule []scheduleRow, month int) float64 {
	label := fmt.Sprintf("%d월", month)
	for _, s := range schedule {
		if s.Label == label {
			return s.Payment
		}
	}
	return 0
}
