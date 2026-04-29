package handlers

import (
	"net/http"
	"strings"
	"time"

	"opengovsupport/backend/domain"
)

// registerProperty wires POST /api/property/consult onto the mux.
func registerProperty(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/property/consult", handlePropertyConsult)
}

// propertyRequest mirrors the Inputs declared for "property/consult" in
// domain/features.go.
type propertyRequest struct {
	Year             int     `json:"year"`
	Mode             string  `json:"mode"`
	Previous         float64 `json:"previous"`
	Current          float64 `json:"current"`
	BaselineDate     string  `json:"baselineDate"`
	CurrentDate      string  `json:"currentDate"`
	Category         string  `json:"category"`
	DeductionRate    float64 `json:"deductionRate"`
	MonthlyDeduction float64 `json:"monthlyDeduction"`
}

func handlePropertyConsult(w http.ResponseWriter, r *http.Request) {
	raw, err := decodeAny(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	req := propertyRequest{
		Year:             int(domain.ToFloat(raw["year"])),
		Mode:             domain.ToString(raw["mode"]),
		Previous:         domain.ToFloat(raw["previous"]),
		Current:          domain.ToFloat(raw["current"]),
		BaselineDate:     domain.ToString(raw["baselineDate"]),
		CurrentDate:      domain.ToString(raw["currentDate"]),
		Category:         domain.ToString(raw["category"]),
		DeductionRate:    domain.ToFloat(raw["deductionRate"]),
		MonthlyDeduction: domain.ToFloat(raw["monthlyDeduction"]),
	}
	if req.Year == 0 {
		req.Year = domain.CurrentYear()
	}
	if req.DeductionRate == 0 {
		if v, ok := domain.OtherGiftRate[req.Year]; ok {
			req.DeductionRate = v
		}
	}

	mode := strings.TrimSpace(req.Mode)
	var (
		text  string
		title string
	)
	switch mode {
	case "금융재산":
		title = "[금융재산 기타증여재산]"
		text = buildFinancialMessage(req)
	case "일반재산":
		title = "[일반재산 기타증여재산]"
		text = buildGeneralPropertyMessage(req)
	case "주택조사결과":
		title = "주택조사결과 반영"
		text = buildHousingMessage(req)
	default:
		writeError(w, http.StatusBadRequest, "C3에 선택된 값이 없습니다.")
		return
	}

	diff := req.Current - req.Previous
	res := Result{
		Title: title,
		Text:  text,
		Data: map[string]any{
			"year":             req.Year,
			"mode":             mode,
			"previous":         req.Previous,
			"current":          req.Current,
			"diff":             diff,
			"category":         req.Category,
			"baselineDate":     req.BaselineDate,
			"currentDate":      req.CurrentDate,
			"deductionRate":    req.DeductionRate,
			"monthlyDeduction": req.MonthlyDeduction,
		},
	}
	writeJSON(w, http.StatusOK, res)
}

// buildFinancialMessage emits the 금융재산 narrative — current/prior/diff,
// reference date, and the common deduction footer.
func buildFinancialMessage(req propertyRequest) string {
	diff := req.Current - req.Previous
	var b strings.Builder
	b.WriteString("[금융재산 기타증여재산]")
	b.WriteString("\r\n")
	b.WriteString("* 금회 " + domain.Won(req.Current))
	b.WriteString(" 직전 " + domain.Won(req.Previous))
	b.WriteString(" 차액 " + domain.Won(diff))
	b.WriteString(" 기준일자 " + req.CurrentDate)

	b.WriteString(buildCommonDeductionSection(req, diff))
	return b.String()
}

// buildGeneralPropertyMessage emits the 일반재산 narrative — Current is taken
// as the disposal amount and Category as 대상물건.
func buildGeneralPropertyMessage(req propertyRequest) string {
	diff := req.Current
	var b strings.Builder
	b.WriteString("[일반재산 기타증여재산]")
	b.WriteString("\r\n")
	b.WriteString("* 대상물건: " + req.Category)
	b.WriteString("\r\n")
	b.WriteString("* 처분금액 " + domain.Won(diff) + ", 처분일자 " + req.CurrentDate)

	b.WriteString(buildCommonDeductionSection(req, diff))
	return b.String()
}

// buildHousingMessage emits the 주택조사결과 narrative.
//   - Category is the survey heading text (e.g. "정기조사", "신규신청 …")
//   - Previous / Current are the prior and current 주택가
//   - diff = current - previous
//   - When Category contains "신규신청" the diff section is skipped.
func buildHousingMessage(req propertyRequest) string {
	diff := req.Current - req.Previous
	var b strings.Builder
	b.WriteString(req.Category + "에 따른 주택조사결과 반영")
	b.WriteString("\r\n\r\n")

	if strings.Contains(req.Category, "신규신청") {
		b.WriteString("* 금회 " + domain.Won(req.Current))
		return b.String()
	}

	b.WriteString("* 금회 " + domain.Won(req.Current))
	b.WriteString(", 직전 " + domain.Won(req.Previous))

	if diff > 0 {
		b.WriteString("  차액 " + domain.Won(diff) + " 기준일자 " + req.CurrentDate)
		b.WriteString(buildCommonDeductionSection(req, diff))
	}

	// 소득인정액(항상 출력) — 별도 입력이 없을 때는 직전/금회를 그대로 비교.
	b.WriteString("\r\n")
	if req.Current == req.Previous {
		b.WriteString("\r\n소득인정액 " + domain.Won(req.Current) + " 변경 없음")
	} else {
		b.WriteString("\r\n소득인정액 금회 " + domain.Won(req.Current) +
			" 직전 " + domain.Won(req.Previous))
		if req.Current < req.Previous {
			b.WriteString(" 감소함")
		} else {
			b.WriteString(" 증가함")
		}
	}
	return b.String()
}

// buildCommonDeductionSection emits the shared deduction footer used by the
// 금융재산 / 일반재산 / 주택조사결과 narratives. Computes 초기차감 from
// baselineDate→currentDate at the resolved deductionRate.
func buildCommonDeductionSection(req propertyRequest, target float64) string {
	var b strings.Builder

	hasExtra := false
	otherDeduction := 0.0

	// Extra-deductions block (타재산증가분 / 부채상환금) — only the manual monthly figure
	// is present in the API, treat it as the catch-all "기타차감" amount when > 0.
	if req.MonthlyDeduction > 0 {
		hasExtra = true
		otherDeduction = req.MonthlyDeduction
		b.WriteString("\r\n* 기타차감 " + domain.Won(req.MonthlyDeduction))
	}

	// Year comparison logic (yearC2 from baselineDate, yearC7 from currentDate).
	yearC2, yearC7 := 0, 0
	bDate, bErr := domain.ParseDate(req.BaselineDate)
	cDate, cErr := domain.ParseDate(req.CurrentDate)
	if bErr == nil {
		yearC2 = bDate.Year()
	}
	if cErr == nil {
		yearC7 = cDate.Year()
	}
	manualMode := false
	if yearC2 > 0 && yearC7 > 0 && yearC7 <= yearC2-2 {
		manualMode = true
	}

	if manualMode {
		// Hypothetical 가계산: previous-year Jan 1 → currentDate.
		var hypothetical float64
		if cErr == nil {
			hypoStart := time.Date(yearC2-1, 1, 1, 0, 0, 0, 0, cDate.Location())
			months := domain.MonthsBetween(hypoStart, cDate)
			if months < 0 {
				months = 0
			}
			hypothetical = req.DeductionRate * req.Previous * float64(months)
		}
		grandTotal := hypothetical + otherDeduction

		if target <= grandTotal {
			b.WriteString("\r\n* " + itoaInt(yearC2-1) + "년 1월 기준 초기차감금액 " +
				domain.Won(hypothetical) +
				"으로 기준일자까지 계산하지 않아도 차액이 차감금액보다 적어 반영하지 않음")
		} else if hasExtra {
			b.WriteString("\r\n* 초기차감금액(행복이음 계산 후 수기입력)원, 총 차감금액( )원 (반영함/으로 차금금액보다 적어 반영하지 않음)")
		} else {
			b.WriteString("\r\n* 초기차감금액(행복이음 계산 후 수기입력)원 (반영함/으로 차금금액보다 적어 반영하지 않음)")
		}
		return b.String()
	}

	// 정상 계산 — 초기차감 = months(baselineDate→currentDate) * rate * previous.
	initialDeduction := 0.0
	if bErr == nil && cErr == nil {
		months := domain.MonthsBetween(bDate, cDate)
		if months < 0 {
			months = 0
		}
		initialDeduction = req.DeductionRate * req.Previous * float64(months)
	}
	totalDeduction := initialDeduction + otherDeduction

	b.WriteString("\r\n* 초기차감금액 " + domain.Won(initialDeduction))
	if hasExtra {
		b.WriteString(", 총 차감금액 " + domain.Won(totalDeduction))
	}
	if target > totalDeduction {
		b.WriteString(" 반영함")
	} else {
		b.WriteString("으로 차감금액보다 적어 반영하지 않음")
	}
	return b.String()
}

// itoaInt — local int→string helper to avoid pulling strconv just for this one spot.
func itoaInt(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
