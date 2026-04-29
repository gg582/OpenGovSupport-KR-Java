package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"opengovsupport/backend/domain"
)

// 06_해외체류 — 신규/기존 신청자 + 기초·장애인 연금 + 차상위 본인부담경감.

func registerOverseas(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/overseas/new", handleOverseasNew)
	mux.HandleFunc("POST /api/overseas/existing", handleOverseasExisting)
	mux.HandleFunc("POST /api/overseas/pension", handleOverseasPension)
	mux.HandleFunc("POST /api/overseas/care", handleOverseasCare)
}

type tripInput struct {
	Departure string `json:"departure"`
	Arrival   string `json:"arrival"`
}

type tripRow struct {
	Departure   string `json:"departure"`
	Arrival     string `json:"arrival"`
	Days        int    `json:"days"`
	NoteArrival string `json:"arrivalLabel"` // "미입국" 또는 yyyy-mm-dd
}

// ── 신규 신청자 ─────────────────────────────────────────────────────
type overseasNewBody struct {
	ApplicationDate string      `json:"applicationDate"`
	Trips           []tripInput `json:"trips"`
}

func handleOverseasNew(w http.ResponseWriter, r *http.Request) {
	var body overseasNewBody
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "요청을 해석하지 못했습니다: "+err.Error())
		return
	}
	appDate, err := domain.ParseDate(body.ApplicationDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "보장결정일이 올바른 날짜가 아닙니다.")
		return
	}
	day180 := appDate.AddDate(0, 0, 180)
	rows, total, day61Date, found61 := computeTripDays(body.Trips, appDate, time.Now())

	var recordsText strings.Builder
	for _, row := range rows {
		recordsText.WriteString(fmt.Sprintf("  - %s ~ %s (%d일)\n", row.Departure, row.NoteArrival, row.Days))
	}
	if recordsText.Len() == 0 {
		recordsText.WriteString("  (출입국 기록 없음)\n")
	}

	str61 := "해당 없음 (현재 총 " + fmt.Sprintf("%d", total) + "일)"
	if found61 {
		str61 = domain.FormatKDate(day61Date)
	}

	finalText := fmt.Sprintf(
		"해외체류 일수 확인\n"+
			"* 보장결정일 : %s\n"+
			"* 180일 도래일 : %s\n"+
			"* 출입국 기록 : [총합 : %d일]\n"+
			"%s"+
			"* 61일째 되는날 : %s",
		body.ApplicationDate, domain.FormatKDate(day180), total, recordsText.String(), str61,
	)

	writeJSON(w, http.StatusOK, Result{
		Title: "신규 신청자 해외체류",
		Text:  finalText,
		Data: map[string]any{
			"trips":     rows,
			"totalDays": total,
			"day180":    domain.FormatKDate(day180),
			"day61":     str61,
		},
	})
}

// ── 기존 수급자 ─────────────────────────────────────────────────────
type overseasExistingBody struct {
	BaselineDate string      `json:"baselineDate"` // 역산 180일
	Trips        []tripInput `json:"trips"`
	NoticeDate   string      `json:"noticeDate"` // 행복이음 통보일 (선택)
}

func handleOverseasExisting(w http.ResponseWriter, r *http.Request) {
	var body overseasExistingBody
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "요청을 해석하지 못했습니다: "+err.Error())
		return
	}
	baseline, err := domain.ParseDate(body.BaselineDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "기준일이 올바른 날짜가 아닙니다.")
		return
	}
	notice := time.Now()
	if body.NoticeDate != "" {
		if t, err := domain.ParseDate(body.NoticeDate); err == nil {
			notice = t
		}
	}
	rows, total, day61Date, found61 := computeTripDays(body.Trips, baseline, notice)

	var recordsText strings.Builder
	for _, row := range rows {
		recordsText.WriteString(fmt.Sprintf("  - %s ~ %s (%d일)\n", row.Departure, row.NoteArrival, row.Days))
	}
	if recordsText.Len() == 0 {
		recordsText.WriteString("  (출입국 기록 없음)\n")
	}

	str61 := "해당 없음 (현재 총 " + fmt.Sprintf("%d", total) + "일)"
	if found61 {
		str61 = domain.FormatKDate(day61Date)
	}

	finalText := fmt.Sprintf(
		"해외체류 일수 확인\n"+
			"* 행복이음 통보일 : %s\n"+
			"* 역산 180일 : %s\n"+
			"* 출입국 기록 : [총합 : %d일] \n"+
			"%s"+
			"* 61일째 되는날 : %s",
		domain.FormatKDate(notice), domain.FormatKDate(baseline), total, recordsText.String(), str61,
	)

	writeJSON(w, http.StatusOK, Result{
		Title: "기존 수급자 해외체류",
		Text:  finalText,
		Data: map[string]any{
			"trips":     rows,
			"totalDays": total,
			"day61":     str61,
		},
	})
}

// computeTripDays clamps each trip's effective departure to the baseline,
// counts days, and reports when the cumulative total crosses 61 days.
func computeTripDays(trips []tripInput, baseline time.Time, fallbackArrival time.Time) (rows []tripRow, total int, day61 time.Time, found61 bool) {
	for _, t := range trips {
		dep, err := domain.ParseDate(t.Departure)
		if err != nil {
			continue
		}
		calcDep := dep
		if calcDep.Before(baseline) {
			calcDep = baseline.AddDate(0, 0, -1)
		}
		var days int
		var arrLabel string
		arr, arrErr := domain.ParseDate(t.Arrival)
		if arrErr != nil || strings.TrimSpace(t.Arrival) == "" {
			arrLabel = "미입국"
			days = int(fallbackArrival.Sub(calcDep).Hours() / 24)
		} else {
			arrLabel = domain.FormatKDate(arr)
			days = int(arr.Sub(calcDep).Hours()/24) - 1
		}
		if days < 0 {
			days = 0
		}
		rows = append(rows, tripRow{
			Departure:   domain.FormatKDate(dep),
			Arrival:     t.Arrival,
			Days:        days,
			NoteArrival: arrLabel,
		})
		if !found61 && total+days >= 61 {
			daysNeeded := 61 - total
			day61 = calcDep.AddDate(0, 0, daysNeeded-1)
			found61 = true
		}
		total += days
	}
	return rows, total, day61, found61
}

// ── 기초/장애인 연금 ────────────────────────────────────────────────
type overseasPensionBody struct {
	DepartureDate string `json:"departureDate"`
	PensionType   string `json:"pensionType"`
}

func handleOverseasPension(w http.ResponseWriter, r *http.Request) {
	var body overseasPensionBody
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "요청을 해석하지 못했습니다: "+err.Error())
		return
	}
	dep, err := domain.ParseDate(body.DepartureDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "출국일이 올바른 날짜가 아닙니다.")
		return
	}
	target := dep.AddDate(0, 0, 61)
	pensionType := strings.TrimSpace(body.PensionType)

	var titleText, tailText string
	switch pensionType {
	case "기초연금":
		titleText = "[기초연금 60일경과 연속 출국자 급여정지]"
		tailText = "* 급여정지한 달까지 지급, 입국한 다음달부터 지급"
	case "장애인연금":
		titleText = "[장애인연금 60일경과 연속 출국자 일시정지]"
		tailText = "* 일시정지한 달까지 지급, 입국한 다음달부터 지급"
	case "기초+장애인 모두", "기초연금 및 장애인연금":
		titleText = "[기초연금(급여정지) 및 장애인연금(일시정지) 60일경과 연속 출국자]"
		tailText = "* 급여정지(일시정지)한 달까지 지급, 입국한 다음달부터 지급"
	default:
		if pensionType == "" {
			titleText = "[60일경과 연속 출국자 정지]"
		} else {
			titleText = "[" + pensionType + " 60일경과 연속 출국자 정지]"
		}
		tailText = "* 정지한 달까지 지급, 입국한 다음달부터 지급"
	}

	finalText := fmt.Sprintf(
		"%s\n* 출국일 : %s\n* 61일째 되는날 : %s\n%s",
		titleText, domain.FormatKDate(dep), domain.FormatKDate(target), tailText,
	)

	writeJSON(w, http.StatusOK, Result{
		Title: "기초/장애인 연금 — 60일 경과",
		Text:  finalText,
		Data: map[string]any{
			"departure": domain.FormatKDate(dep),
			"target":    domain.FormatKDate(target),
		},
	})
}

// ── 차상위 본인부담경감 ────────────────────────────────────────────
type overseasCareBody struct {
	DepartureDate string `json:"departureDate"`
}

func handleOverseasCare(w http.ResponseWriter, r *http.Request) {
	var body overseasCareBody
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "요청을 해석하지 못했습니다: "+err.Error())
		return
	}
	dep, err := domain.ParseDate(body.DepartureDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "출국일이 올바른 날짜가 아닙니다.")
		return
	}
	target := domain.AddMonths(dep, 3)
	finalText := fmt.Sprintf(
		"[차상위본인부담경감 3개월 이상 연속 출국자 중지 요청]\n"+
			"* 출국일 : %s\n"+
			"* 3개월 경과일 : %s",
		domain.FormatKDate(dep), domain.FormatKDate(target),
	)
	writeJSON(w, http.StatusOK, Result{
		Title: "차상위 본인부담경감",
		Text:  finalText,
		Data: map[string]any{
			"departure": domain.FormatKDate(dep),
			"target":    domain.FormatKDate(target),
		},
	})
}
