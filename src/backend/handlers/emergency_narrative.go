package handlers

import (
	"fmt"
	"math"
	"strings"
	"time"

	"opengovsupport/backend/domain"
)

// buildDeductionSchedule collapses period rows that share the same calendar
// month, computes per-month deduction/payment pairs, and walks the months in
// the support window emitting the row sequence the narrative consumes.
func buildDeductionSchedule(rows []periodRow, dStart time.Time, req emergencyRequest) []scheduleRow {
	if len(rows) == 0 {
		return nil
	}
	// Build per-month aggregates of (deduction, payment, base) — first
	// occurrence wins for the base amount.
	type rawCell struct {
		ded  float64
		pay  float64
		base float64
	}
	raw := make(map[int]*rawCell) // keyed by month
	for _, rr := range rows {
		c, ok := raw[rr.EndMonth]
		if !ok {
			c = &rawCell{base: rr.BaseAmount}
			raw[rr.EndMonth] = c
		}
		c.ded += rr.Payable
	}
	for _, c := range raw {
		net := c.base - c.ded
		if c.ded == 0 {
			c.pay = 0
		} else {
			c.pay = roundUpToTen(net)
			if c.pay < 0 {
				c.pay = 0
			}
		}
	}

	// Walk every month inside the support window, emitting one row per month
	// plus the special "첫지급 N월 지급액" / "다음달 N월 지급액" markers used
	// by the narrative.
	last := rows[len(rows)-1]
	lastD := time.Date(last.Year, time.Month(last.EndMonth), 1, 0, 0, 0, 0, dStart.Location())
	c2D := time.Date(dStart.Year(), dStart.Month(), 1, 0, 0, 0, 0, dStart.Location())
	reqD := c2D
	c7D := lastD

	var out []scheduleRow
	var subDed, subPay, totDed, totPay float64

	tempD := reqD
	for !tempD.After(maxDate(lastD, c7D)) {
		mVal := int(tempD.Month())

		var ded, pay float64
		baseTemp := computeBaseAmount(req)
		if tempD.Before(c2D) {
			ded = 0
			pay = baseTemp
		} else if cell, ok := raw[mVal]; ok {
			ded = cell.ded
			pay = cell.pay
		} else {
			ded = 0
			pay = baseTemp
		}
		totDed += ded
		totPay += pay

		if !tempD.After(c7D) {
			out = append(out, scheduleRow{
				Label:     fmt.Sprintf("%d월", mVal),
				Deduction: ded,
				Payment:   pay,
			})
			subDed += ded
			subPay += pay
			if tempD.Equal(c7D) {
				out = append(out, scheduleRow{
					Label:     fmt.Sprintf("첫지급 %d월 지급액", mVal),
					Deduction: subDed,
					Payment:   subPay,
				})
			}
		} else {
			out = append(out, scheduleRow{
				Label:     fmt.Sprintf("다음달 %d월 지급액", mVal),
				Deduction: ded,
				Payment:   pay,
			})
		}
		tempD = domain.AddMonths(tempD, 1)
	}
	out = append(out, scheduleRow{
		Label:     "총합",
		Deduction: totDed,
		Payment:   totPay,
	})
	return out
}

// buildNarrative renders the human-readable memo: explanation + per-차 rows
// + per-month payment lines + grand-total summary.
func buildNarrative(rows []periodRow, schedule []scheduleRow, dStart, dEnd time.Time, req emergencyRequest) string {
	var b strings.Builder
	b.WriteString("긴급지원을 받으신 적이 있는 경우, 그 금액만큼 기초생계급여에서 나눠서 차감(공제)한 뒤 지급합니다.\r\n")
	b.WriteString("차감 금액은 긴급지원을 받은 날부터 하루 단위로 계산한 뒤, 월별로 합산하여 기초생계급여에서 빼게 됩니다.\r\n\r\n")

	famCount := fmt.Sprintf("%g", req.HouseholdSize)
	incVal := domain.FormatThousands(int64(math.Round(req.IncomeBaseline)))

	// 연도별 기준액 메모: 한 행에 (해당 기간 안의) 연도마다 하나씩.
	seen := map[int]bool{}
	var baseStr strings.Builder
	for _, rr := range rows {
		if seen[rr.Year] {
			continue
		}
		seen[rr.Year] = true
		if baseStr.Len() > 0 {
			baseStr.WriteString(", ")
		}
		baseStr.WriteString(fmt.Sprintf("%d년 월 %s원",
			rr.Year, domain.FormatThousands(int64(math.Round(rr.BaseAmount)))))
	}

	b.WriteString("* 보장가구원수는 " + famCount + "인이며, 소득인정액 " + incVal +
		"원으로 기초생계급여 기준액은 " + baseStr.String() +
		"입니다. 월별 지급금액은 다음과 같습니다.\r\n\r\n")

	cutDay := dStart.Day()
	if len(rows) == 0 {
		return b.String()
	}

	// Per-차 loop. The narrative emits two rows per cycle when the cutoff day
	// is mid-month (cutDay > 1) — first the "first-half" then the "second-half".
	stepVal := 2
	if cutDay == 1 {
		stepVal = 1
	}

	for i := 0; i < len(rows); i += stepVal {
		hasRow2 := false
		var p int
		if cutDay == 1 {
			p = i + 1 // 1-based 차수
			hasRow2 = false
		} else {
			p = (i / 2) + 1
			hasRow2 = i+1 < len(rows)
		}
		r1 := rows[i]
		var r2 periodRow
		if hasRow2 {
			r2 = rows[i+1]
		}

		pStart := time.Date(r1.Year, time.Month(r1.StartMonth), r1.StartDay, 0, 0, 0, 0, time.UTC)
		var pEnd time.Time
		if hasRow2 {
			pEnd = time.Date(r2.Year, time.Month(r2.EndMonth), r2.EndDay, 0, 0, 0, 0, time.UTC)
		} else {
			pEnd = time.Date(r1.Year, time.Month(r1.EndMonth), r1.EndDay, 0, 0, 0, 0, time.UTC)
		}

		b.WriteString(fmt.Sprintf("%d차 긴급지원 기간 %s부터 %s까지이며,\r\n",
			p, pStart.Format("2006-01-02"), pEnd.Format("2006-01-02")))

		// Row 1 narrative
		suffix := "받은 것으로 봅니다."
		if hasRow2 {
			suffix = "받은 것이고"
		}
		b.WriteString(fmt.Sprintf("* %d월분은 %d일부터 %d일까지 총 %d일 동안 %s원을 %s\r\n",
			r1.StartMonth, r1.StartDay, r1.EndDay, r1.AppliedDays,
			domain.FormatThousands(int64(math.Round(r1.AppliedAmt))), suffix))

		if hasRow2 {
			b.WriteString(fmt.Sprintf("* %d월분은 %d일에서 %d일까지 총 %d일 동안 %s원을 받은 것으로 봅니다.\r\n",
				r2.StartMonth, r2.StartDay, r2.EndDay, r2.AppliedDays,
				domain.FormatThousands(int64(math.Round(r2.AppliedAmt)))))
		}

		// Per-month payment line.
		pay1 := scheduleLookup(schedule, r1.StartMonth)
		if cutDay == 1 || p == 1 {
			b.WriteString(fmt.Sprintf("- %d월분은 기준액 %s원에서 %s원을 빼고 %s원이 지급됩니다.\r\n\r\n",
				r1.StartMonth,
				domain.FormatThousands(int64(math.Round(r1.BaseAmount))),
				domain.FormatThousands(int64(math.Round(r1.AppliedAmt))),
				domain.FormatThousands(int64(math.Round(pay1)))))
		} else {
			// Overlap month: combines previous half with this half.
			prev := rows[i-1]
			amtPrev := prev.AppliedAmt
			daysPrev := prev.AppliedDays
			totalAmt := amtPrev + r1.AppliedAmt

			var body string
			if totalAmt >= r1.BaseAmount {
				body = fmt.Sprintf("기초생계급여 기준액 %s원보다 많이 받아서 0원 지급됩니다.",
					domain.FormatThousands(int64(math.Round(r1.BaseAmount))))
			} else {
				body = fmt.Sprintf("기초생계급여 기준액 %s원에서 빼고 %s원 지급됩니다.",
					domain.FormatThousands(int64(math.Round(r1.BaseAmount))),
					domain.FormatThousands(int64(math.Round(pay1))))
			}
			prefix := fmt.Sprintf("긴급지원금액은 %d차분 %d일치 %s원과 %d차분 %d일치 %s원을 합쳐서 %s원을 받은 것으로 하여 ",
				p-1, daysPrev,
				domain.FormatThousands(int64(math.Round(amtPrev))),
				p, r1.AppliedDays,
				domain.FormatThousands(int64(math.Round(r1.AppliedAmt))),
				domain.FormatThousands(int64(math.Round(totalAmt))))
			b.WriteString(fmt.Sprintf("- %d월분은 %s%s\r\n\r\n",
				r1.StartMonth, prefix, body))
		}
	}

	// Total summary line.
	var grand float64
	for _, s := range schedule {
		if s.Label == "총합" {
			grand = s.Payment
			break
		}
	}
	last := rows[len(rows)-1]
	b.WriteString(fmt.Sprintf("%d월까지의 기초생계급여 총 합산 지급액은 %s원입니다.\r\n",
		last.EndMonth, domain.FormatThousands(int64(math.Round(grand)))))

	_ = dEnd
	return b.String()
}
