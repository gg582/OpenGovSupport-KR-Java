package handlers

import (
	"math"
	"time"
)

// buildPeriodTable splits the support window into per-month rows. When the
// start day is the 1st of a month every row covers a full month; otherwise
// each subsequent month is split into a "first half" (day 1 → cutDay-1) and
// "second half" (cutDay → end-of-month) pair.
func buildPeriodTable(dStart, dEnd time.Time) []periodRow {
	rows := []periodRow{}
	cutDay := dStart.Day()
	firstHalfEnd := cutDay - 1

	if cutDay == 1 {
		// One row per month from start month to end month.
		tmp := time.Date(dStart.Year(), dStart.Month(), 1, 0, 0, 0, 0, dStart.Location())
		endM := time.Date(dEnd.Year(), dEnd.Month(), 1, 0, 0, 0, 0, dEnd.Location())
		for !tmp.After(endM) {
			rows = append(rows, periodRow{
				Year:       tmp.Year(),
				StartMonth: int(tmp.Month()),
				StartDay:   1,
				EndMonth:   int(tmp.Month()),
				EndDay:     lastDayOfMonth(tmp.Year(), int(tmp.Month())),
			})
			tmp = time.Date(tmp.Year(), tmp.Month()+1, 1, 0, 0, 0, 0, tmp.Location())
		}
		return rows
	}

	// First row: dStart-month from cutDay through end-of-month.
	rows = append(rows, periodRow{
		Year:       dStart.Year(),
		StartMonth: int(dStart.Month()),
		StartDay:   dStart.Day(),
		EndMonth:   int(dStart.Month()),
		EndDay:     lastDayOfMonth(dStart.Year(), int(dStart.Month())),
	})

	// Last first-half month to emit. If Day(dEnd) > firstHalfEnd, the last
	// first-half row belongs to the month AFTER dEnd's month.
	var lastFirstHalfMonth time.Time
	if dEnd.Day() > firstHalfEnd {
		lastFirstHalfMonth = time.Date(dEnd.Year(), dEnd.Month()+1, 1, 0, 0, 0, 0, dEnd.Location())
	} else {
		lastFirstHalfMonth = time.Date(dEnd.Year(), dEnd.Month(), 1, 0, 0, 0, 0, dEnd.Location())
	}

	m := time.Date(dStart.Year(), dStart.Month()+1, 1, 0, 0, 0, 0, dStart.Location())
	for !m.After(lastFirstHalfMonth) {
		rows = append(rows, periodRow{
			Year:       m.Year(),
			StartMonth: int(m.Month()),
			StartDay:   1,
			EndMonth:   int(m.Month()),
			EndDay:     firstHalfEnd,
		})
		if m.Equal(lastFirstHalfMonth) {
			break
		}
		rows = append(rows, periodRow{
			Year:       m.Year(),
			StartMonth: int(m.Month()),
			StartDay:   cutDay,
			EndMonth:   int(m.Month()),
			EndDay:     lastDayOfMonth(m.Year(), int(m.Month())),
		})
		m = time.Date(m.Year(), m.Month()+1, 1, 0, 0, 0, 0, m.Location())
	}
	return rows
}

// annotateBaseAndEmergency fills the emergency amount (E) and base amount (F)
// columns on every row. A single incomeBaseline + deductionRate is applied to
// every year inside the period — callers seed those defaults from the law-based
// tables before calling.
func annotateBaseAndEmergency(rows []periodRow, req emergencyRequest) {
	base := computeBaseAmount(req)
	for i := range rows {
		rows[i].EmergencyAmt = req.MonthlyAmount
		rows[i].BaseAmount = base
	}
}

// computeBaseAmount = round(income × rate). The API takes the resolved
// incomeBaseline directly, so per-row 가구원수 lookups are not done here.
func computeBaseAmount(req emergencyRequest) float64 {
	v := math.Round(req.IncomeBaseline * req.DeductionRate)
	if v < 0 {
		v = 0
	}
	return v
}

// annotateDaysAndPayable fills the derived columns: days-in-month, applied
// days, daily amount, applied amount, and the final payable amount per row.
func annotateDaysAndPayable(rows []periodRow) {
	for i := range rows {
		r := &rows[i]
		r.DaysInMonth = lastDayOfMonth(r.Year, r.StartMonth)
		r.AppliedDays = r.EndDay - r.StartDay + 1
		if r.DaysInMonth > 0 {
			r.DailyAmount = r.EmergencyAmt / float64(r.DaysInMonth)
		}
		r.AppliedAmt = math.Round(r.DailyAmount * float64(r.AppliedDays))
		if r.BaseAmount <= r.AppliedAmt {
			r.Payable = r.BaseAmount
		} else {
			r.Payable = r.AppliedAmt
		}
	}
}
