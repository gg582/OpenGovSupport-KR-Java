package com.opengov.support.domain;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;

/** 숫자/날짜/문자열 변환을 위한 공용 유틸. Go의 domain/util.go 와 1:1 대응. */
public final class DomainUtil {

    private DomainUtil() {}

    private static final List<DateTimeFormatter> DATE_FORMATS = List.of(
            DateTimeFormatter.ofPattern("yyyy-MM-dd"),
            DateTimeFormatter.ofPattern("yyyy/MM/dd"),
            DateTimeFormatter.ofPattern("yyyy.MM.dd"),
            DateTimeFormatter.ofPattern("yyyyMMdd")
    );

    private static final DateTimeFormatter K_DATE = DateTimeFormatter.ofPattern("yyyy.MM.dd");
    private static final DateTimeFormatter ISO_DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    /** Won formats a number with thousands separators and the "원" suffix. */
    public static String won(double v) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return "0원";
        return formatThousands(Math.round(v)) + "원";
    }

    /** FormatThousands inserts commas every three digits. */
    public static String formatThousands(long n) {
        boolean neg = n < 0;
        long abs = neg ? -n : n;
        String s = Long.toString(abs);
        StringBuilder out = new StringBuilder(s.length() + s.length() / 3);
        int len = s.length();
        for (int i = 0; i < len; i++) {
            if (i != 0 && (len - i) % 3 == 0) out.append(',');
            out.append(s.charAt(i));
        }
        return neg ? "-" + out : out.toString();
    }

    /** Accepts YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, YYYYMMDD. */
    public static LocalDate parseDate(String s) {
        if (s == null) throw new IllegalArgumentException("invalid date: null");
        String t = s.trim();
        for (DateTimeFormatter f : DATE_FORMATS) {
            try {
                return LocalDate.parse(t, f);
            } catch (Exception ignored) {
                // try next
            }
        }
        throw new IllegalArgumentException("invalid date: \"" + s + "\"");
    }

    /** Returns the inclusive number of full calendar months between two dates. */
    public static int monthsBetween(LocalDate start, LocalDate end) {
        if (end.isBefore(start)) return 0;
        int years = end.getYear() - start.getYear();
        int months = end.getMonthValue() - start.getMonthValue();
        return years * 12 + months + 1;
    }

    /** Returns end - start in calendar days. */
    public static int daysBetween(LocalDate start, LocalDate end) {
        if (end.isBefore(start)) return 0;
        return (int) ChronoUnit.DAYS.between(start, end);
    }

    /** Adds n months keeping day of month (clamped to last valid day). */
    public static LocalDate addMonths(LocalDate t, int n) {
        return t.plusMonths(n);
    }

    /** Renders a Date as "YYYY.MM.DD" (Korean style used in original messages). */
    public static String formatKDate(LocalDate t) {
        return t.format(K_DATE);
    }

    /** Renders a Date as "YYYY-MM-DD". */
    public static String formatIsoDate(LocalDate t) {
        return t.format(ISO_DATE);
    }

    /** Best-effort coerce any value to double. */
    public static double toDouble(Object v) {
        if (v == null) return 0;
        if (v instanceof Number n) return n.doubleValue();
        if (v instanceof Boolean b) return b ? 1 : 0;
        if (v instanceof String s) {
            String t = s.trim().replace(",", "");
            if (t.isEmpty()) return 0;
            try {
                return Double.parseDouble(t);
            } catch (NumberFormatException e) {
                return 0;
            }
        }
        return 0;
    }

    /** Best-effort coerce any value to int. */
    public static int toInt(Object v) {
        return (int) toDouble(v);
    }

    /** Safe string-from-anything. */
    public static String toStr(Object v) {
        if (v == null) return "";
        if (v instanceof String s) return s;
        return v.toString();
    }
}
