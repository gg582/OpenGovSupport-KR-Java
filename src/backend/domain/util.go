package domain

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// ───── number / money helpers ─────

// Won formats a number with thousands separators and the "원" suffix.
func Won(v float64) string {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return "0원"
	}
	return FormatThousands(int64(math.Round(v))) + "원"
}

// FormatThousands inserts commas every three digits.
func FormatThousands(n int64) string {
	neg := n < 0
	if neg {
		n = -n
	}
	s := strconv.FormatInt(n, 10)
	var out []byte
	for i, c := range []byte(s) {
		if i != 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, c)
	}
	if neg {
		return "-" + string(out)
	}
	return string(out)
}

// ───── date helpers ─────

// ParseDate accepts YYYY-MM-DD, YYYY/MM/DD, or YYYY.MM.DD.
func ParseDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	for _, layout := range []string{"2006-01-02", "2006/01/02", "2006.01.02", "20060102"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid date: %q", s)
}

// MonthsBetween returns the inclusive number of full calendar months
// between two dates (counting both the start and end month).
func MonthsBetween(start, end time.Time) int {
	if end.Before(start) {
		return 0
	}
	years := end.Year() - start.Year()
	months := int(end.Month()) - int(start.Month())
	return years*12 + months + 1
}

// DaysBetween returns end - start in calendar days (end inclusive when both are dates).
func DaysBetween(start, end time.Time) int {
	if end.Before(start) {
		return 0
	}
	d := int(end.Sub(start).Hours() / 24)
	return d
}

// AddMonths adds n months keeping the day of month (clamped to last valid day).
func AddMonths(t time.Time, n int) time.Time {
	y, m, d := t.Date()
	target := time.Date(y, m+time.Month(n), 1, 0, 0, 0, 0, t.Location())
	last := time.Date(target.Year(), target.Month()+1, 0, 0, 0, 0, 0, t.Location()).Day()
	if d > last {
		d = last
	}
	return time.Date(target.Year(), target.Month(), d, 0, 0, 0, 0, t.Location())
}

// FormatKDate renders a Date as "YYYY.MM.DD" (Korean style used in original messages).
func FormatKDate(t time.Time) string {
	return t.Format("2006.01.02")
}

// ───── numeric coercion ─────

// ToFloat best-effort coerces any value to float64.
func ToFloat(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case float32:
		return float64(x)
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case string:
		s := strings.ReplaceAll(strings.TrimSpace(x), ",", "")
		if s == "" {
			return 0
		}
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			return f
		}
	}
	return 0
}

// ToString safely returns a string from any value.
func ToString(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}
