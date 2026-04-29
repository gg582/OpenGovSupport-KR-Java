package com.opengov.support.web.controller;

import com.opengov.support.domain.DomainUtil;
import com.opengov.support.domain.Standards;
import com.opengov.support.web.ApiException;
import com.opengov.support.web.JsonBody;
import com.opengov.support.web.Result;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 05_긴급공제설명 — 긴급 지원 대상자의 기간별 공제표와 안내문 생성. */
@RestController
@RequestMapping("/api/emergency")
public class EmergencyController {

    @PostMapping("/explain")
    public Result explain(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        int year = JsonBody.integer(body, "year");
        if (year == 0) year = Standards.currentYear();
        double householdSize = JsonBody.dbl(body, "householdSize");
        double monthlyAmount = JsonBody.dbl(body, "monthlyAmount");
        double incomeBaseline = JsonBody.dbl(body, "incomeBaseline");
        double deductionRate = JsonBody.dbl(body, "deductionRate");

        if (incomeBaseline == 0) {
            Map<Integer, Integer> table = Standards.MEDIAN_INCOME.get(year);
            if (table != null) {
                Integer mi = table.get((int) householdSize);
                if (mi != null) incomeBaseline = mi;
            }
        }
        if (deductionRate == 0) {
            Double r = Standards.LIVING_BENEFIT_RATE.get(year);
            if (r != null) deductionRate = r;
        }

        LocalDate dStart;
        LocalDate dEnd;
        try {
            dStart = DomainUtil.parseDate(JsonBody.str(body, "startDate"));
        } catch (RuntimeException e) {
            throw ApiException.badRequest("시작일에 올바른 날짜를 먼저 입력하세요.");
        }
        try {
            dEnd = DomainUtil.parseDate(JsonBody.str(body, "endDate"));
        } catch (RuntimeException e) {
            throw ApiException.badRequest("종료일에 올바른 날짜를 먼저 입력하세요.");
        }
        if (dEnd.isBefore(dStart)) {
            throw ApiException.badRequest("종료일이 시작일보다 빠릅니다.");
        }

        EmergencyInputs in = new EmergencyInputs(year, householdSize, monthlyAmount, incomeBaseline, deductionRate);

        List<PeriodRow> rows = buildPeriodTable(dStart, dEnd);
        annotateBaseAndEmergency(rows, in);
        annotateDaysAndPayable(rows);

        List<ScheduleRow> schedule = buildDeductionSchedule(rows, dStart, in);
        String narrative = buildNarrative(rows, schedule, dStart, in);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("year", year);
        data.put("periodTable", rows.stream().map(PeriodRow::toMap).toList());
        data.put("deductionSchedule", schedule.stream().map(ScheduleRow::toMap).toList());
        data.put("startDate", DomainUtil.formatKDate(dStart));
        data.put("endDate", DomainUtil.formatKDate(dEnd));
        data.put("householdSize", householdSize);
        data.put("monthlyAmount", monthlyAmount);
        data.put("incomeBaseline", incomeBaseline);
        data.put("deductionRate", deductionRate);
        data.put("computedBaseAmount", computeBaseAmount(in));
        return Result.of("긴급 공제 설명", narrative, data);
    }

    // ─────────────────────────────────────────────────────────────────────
    // helpers
    // ─────────────────────────────────────────────────────────────────────

    private static int lastDayOfMonth(int year, int month) {
        return LocalDate.of(year, month, 1).lengthOfMonth();
    }

    private static double roundUpToTen(double x) {
        if (x == 0) return 0;
        if (x > 0) return Math.ceil(x / 10) * 10;
        return Math.floor(x / 10) * 10;
    }

    private static double computeBaseAmount(EmergencyInputs in) {
        double v = Math.round(in.incomeBaseline * in.deductionRate);
        return v < 0 ? 0 : v;
    }

    private static List<PeriodRow> buildPeriodTable(LocalDate dStart, LocalDate dEnd) {
        List<PeriodRow> rows = new ArrayList<>();
        int cutDay = dStart.getDayOfMonth();
        int firstHalfEnd = cutDay - 1;

        if (cutDay == 1) {
            LocalDate tmp = dStart.withDayOfMonth(1);
            LocalDate endM = dEnd.withDayOfMonth(1);
            while (!tmp.isAfter(endM)) {
                rows.add(new PeriodRow(
                        tmp.getYear(),
                        tmp.getMonthValue(), 1,
                        tmp.getMonthValue(), lastDayOfMonth(tmp.getYear(), tmp.getMonthValue())));
                tmp = tmp.plusMonths(1);
            }
            return rows;
        }

        rows.add(new PeriodRow(
                dStart.getYear(),
                dStart.getMonthValue(), dStart.getDayOfMonth(),
                dStart.getMonthValue(), lastDayOfMonth(dStart.getYear(), dStart.getMonthValue())));

        LocalDate lastFirstHalfMonth;
        if (dEnd.getDayOfMonth() > firstHalfEnd) {
            lastFirstHalfMonth = dEnd.plusMonths(1).withDayOfMonth(1);
        } else {
            lastFirstHalfMonth = dEnd.withDayOfMonth(1);
        }

        LocalDate m = dStart.plusMonths(1).withDayOfMonth(1);
        while (!m.isAfter(lastFirstHalfMonth)) {
            rows.add(new PeriodRow(
                    m.getYear(),
                    m.getMonthValue(), 1,
                    m.getMonthValue(), firstHalfEnd));
            if (m.equals(lastFirstHalfMonth)) break;
            rows.add(new PeriodRow(
                    m.getYear(),
                    m.getMonthValue(), cutDay,
                    m.getMonthValue(), lastDayOfMonth(m.getYear(), m.getMonthValue())));
            m = m.plusMonths(1);
        }
        return rows;
    }

    private static void annotateBaseAndEmergency(List<PeriodRow> rows, EmergencyInputs in) {
        double base = computeBaseAmount(in);
        for (PeriodRow r : rows) {
            r.emergencyAmt = in.monthlyAmount;
            r.baseAmount = base;
        }
    }

    private static void annotateDaysAndPayable(List<PeriodRow> rows) {
        for (PeriodRow r : rows) {
            r.daysInMonth = lastDayOfMonth(r.year, r.startMonth);
            r.appliedDays = r.endDay - r.startDay + 1;
            if (r.daysInMonth > 0) {
                r.dailyAmount = r.emergencyAmt / r.daysInMonth;
            }
            r.appliedAmt = Math.round(r.dailyAmount * r.appliedDays);
            r.payable = r.baseAmount <= r.appliedAmt ? r.baseAmount : r.appliedAmt;
        }
    }

    private static List<ScheduleRow> buildDeductionSchedule(
            List<PeriodRow> rows, LocalDate dStart, EmergencyInputs in) {
        if (rows.isEmpty()) return List.of();

        Map<Integer, RawCell> raw = new HashMap<>();
        for (PeriodRow rr : rows) {
            RawCell c = raw.computeIfAbsent(rr.endMonth, k -> new RawCell(rr.baseAmount));
            c.ded += rr.payable;
        }
        for (RawCell c : raw.values()) {
            double net = c.base - c.ded;
            if (c.ded == 0) {
                c.pay = 0;
            } else {
                c.pay = roundUpToTen(net);
                if (c.pay < 0) c.pay = 0;
            }
        }

        PeriodRow last = rows.get(rows.size() - 1);
        LocalDate lastD = LocalDate.of(last.year, last.endMonth, 1);
        LocalDate c2D = LocalDate.of(dStart.getYear(), dStart.getMonthValue(), 1);
        LocalDate reqD = c2D;
        LocalDate c7D = lastD;

        List<ScheduleRow> out = new ArrayList<>();
        double subDed = 0;
        double subPay = 0;
        double totDed = 0;
        double totPay = 0;

        LocalDate tempD = reqD;
        LocalDate stop = lastD.isAfter(c7D) ? lastD : c7D;
        while (!tempD.isAfter(stop)) {
            int mVal = tempD.getMonthValue();

            double ded;
            double pay;
            double baseTemp = computeBaseAmount(in);
            if (tempD.isBefore(c2D)) {
                ded = 0;
                pay = baseTemp;
            } else if (raw.containsKey(mVal)) {
                RawCell cell = raw.get(mVal);
                ded = cell.ded;
                pay = cell.pay;
            } else {
                ded = 0;
                pay = baseTemp;
            }
            totDed += ded;
            totPay += pay;

            if (!tempD.isAfter(c7D)) {
                out.add(new ScheduleRow(mVal + "월", ded, pay));
                subDed += ded;
                subPay += pay;
                if (tempD.equals(c7D)) {
                    out.add(new ScheduleRow("첫지급 " + mVal + "월 지급액", subDed, subPay));
                }
            } else {
                out.add(new ScheduleRow("다음달 " + mVal + "월 지급액", ded, pay));
            }
            tempD = DomainUtil.addMonths(tempD, 1);
        }
        out.add(new ScheduleRow("총합", totDed, totPay));
        return out;
    }

    private static double scheduleLookup(List<ScheduleRow> schedule, int month) {
        String label = month + "월";
        for (ScheduleRow s : schedule) {
            if (label.equals(s.label)) return s.payment;
        }
        return 0;
    }

    private static String buildNarrative(
            List<PeriodRow> rows, List<ScheduleRow> schedule, LocalDate dStart, EmergencyInputs in) {
        StringBuilder b = new StringBuilder();
        b.append("긴급지원을 받으신 적이 있는 경우, 그 금액만큼 기초생계급여에서 나눠서 차감(공제)한 뒤 지급합니다.\r\n");
        b.append("차감 금액은 긴급지원을 받은 날부터 하루 단위로 계산한 뒤, 월별로 합산하여 기초생계급여에서 빼게 됩니다.\r\n\r\n");

        String famCount = formatHouseholdSize(in.householdSize);
        String incVal = DomainUtil.formatThousands((long) Math.round(in.incomeBaseline));

        Set<Integer> seenYears = new HashSet<>();
        StringBuilder baseStr = new StringBuilder();
        for (PeriodRow rr : rows) {
            if (!seenYears.add(rr.year)) continue;
            if (baseStr.length() > 0) baseStr.append(", ");
            baseStr.append(rr.year).append("년 월 ")
                    .append(DomainUtil.formatThousands((long) Math.round(rr.baseAmount))).append("원");
        }

        b.append("* 보장가구원수는 ").append(famCount)
                .append("인이며, 소득인정액 ").append(incVal)
                .append("원으로 기초생계급여 기준액은 ").append(baseStr)
                .append("입니다. 월별 지급금액은 다음과 같습니다.\r\n\r\n");

        int cutDay = dStart.getDayOfMonth();
        if (rows.isEmpty()) return b.toString();

        int stepVal = cutDay == 1 ? 1 : 2;

        for (int i = 0; i < rows.size(); i += stepVal) {
            boolean hasRow2;
            int p;
            if (cutDay == 1) {
                p = i + 1;
                hasRow2 = false;
            } else {
                p = (i / 2) + 1;
                hasRow2 = i + 1 < rows.size();
            }
            PeriodRow r1 = rows.get(i);
            PeriodRow r2 = hasRow2 ? rows.get(i + 1) : null;

            LocalDate pStart = LocalDate.of(r1.year, r1.startMonth, r1.startDay);
            LocalDate pEnd = hasRow2
                    ? LocalDate.of(r2.year, r2.endMonth, r2.endDay)
                    : LocalDate.of(r1.year, r1.endMonth, r1.endDay);

            b.append(String.format("%d차 긴급지원 기간 %s부터 %s까지이며,\r\n",
                    p, DomainUtil.formatIsoDate(pStart), DomainUtil.formatIsoDate(pEnd)));

            String suffix = hasRow2 ? "받은 것이고" : "받은 것으로 봅니다.";
            b.append(String.format("* %d월분은 %d일부터 %d일까지 총 %d일 동안 %s원을 %s\r\n",
                    r1.startMonth, r1.startDay, r1.endDay, r1.appliedDays,
                    DomainUtil.formatThousands((long) Math.round(r1.appliedAmt)), suffix));

            if (hasRow2) {
                b.append(String.format("* %d월분은 %d일에서 %d일까지 총 %d일 동안 %s원을 받은 것으로 봅니다.\r\n",
                        r2.startMonth, r2.startDay, r2.endDay, r2.appliedDays,
                        DomainUtil.formatThousands((long) Math.round(r2.appliedAmt))));
            }

            double pay1 = scheduleLookup(schedule, r1.startMonth);
            if (cutDay == 1 || p == 1) {
                b.append(String.format("- %d월분은 기준액 %s원에서 %s원을 빼고 %s원이 지급됩니다.\r\n\r\n",
                        r1.startMonth,
                        DomainUtil.formatThousands((long) Math.round(r1.baseAmount)),
                        DomainUtil.formatThousands((long) Math.round(r1.appliedAmt)),
                        DomainUtil.formatThousands((long) Math.round(pay1))));
            } else {
                PeriodRow prev = rows.get(i - 1);
                double amtPrev = prev.appliedAmt;
                int daysPrev = prev.appliedDays;
                double totalAmt = amtPrev + r1.appliedAmt;

                String body;
                if (totalAmt >= r1.baseAmount) {
                    body = String.format("기초생계급여 기준액 %s원보다 많이 받아서 0원 지급됩니다.",
                            DomainUtil.formatThousands((long) Math.round(r1.baseAmount)));
                } else {
                    body = String.format("기초생계급여 기준액 %s원에서 빼고 %s원 지급됩니다.",
                            DomainUtil.formatThousands((long) Math.round(r1.baseAmount)),
                            DomainUtil.formatThousands((long) Math.round(pay1)));
                }
                String prefix = String.format(
                        "긴급지원금액은 %d차분 %d일치 %s원과 %d차분 %d일치 %s원을 합쳐서 %s원을 받은 것으로 하여 ",
                        p - 1, daysPrev,
                        DomainUtil.formatThousands((long) Math.round(amtPrev)),
                        p, r1.appliedDays,
                        DomainUtil.formatThousands((long) Math.round(r1.appliedAmt)),
                        DomainUtil.formatThousands((long) Math.round(totalAmt)));
                b.append(String.format("- %d월분은 %s%s\r\n\r\n", r1.startMonth, prefix, body));
            }
        }

        double grand = 0;
        for (ScheduleRow s : schedule) {
            if ("총합".equals(s.label)) {
                grand = s.payment;
                break;
            }
        }
        PeriodRow last = rows.get(rows.size() - 1);
        b.append(String.format("%d월까지의 기초생계급여 총 합산 지급액은 %s원입니다.\r\n",
                last.endMonth, DomainUtil.formatThousands((long) Math.round(grand))));
        return b.toString();
    }

    /** Go의 fmt %g 처럼 정수 가구원수는 정수로, 소수점은 그대로. */
    private static String formatHouseholdSize(double v) {
        if (v == Math.floor(v) && !Double.isInfinite(v)) {
            return Long.toString((long) v);
        }
        return Double.toString(v);
    }

    private record EmergencyInputs(
            int year, double householdSize, double monthlyAmount,
            double incomeBaseline, double deductionRate) {}

    private static final class RawCell {
        final double base;
        double ded;
        double pay;

        RawCell(double base) {
            this.base = base;
        }
    }

    private static final class PeriodRow {
        final int year;
        final int startMonth;
        final int startDay;
        final int endMonth;
        final int endDay;
        double emergencyAmt;
        double baseAmount;
        int daysInMonth;
        int appliedDays;
        double dailyAmount;
        double appliedAmt;
        double payable;

        PeriodRow(int year, int startMonth, int startDay, int endMonth, int endDay) {
            this.year = year;
            this.startMonth = startMonth;
            this.startDay = startDay;
            this.endMonth = endMonth;
            this.endDay = endDay;
        }

        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("year", year);
            m.put("startMonth", startMonth);
            m.put("startDay", startDay);
            m.put("endMonth", endMonth);
            m.put("endDay", endDay);
            m.put("emergencyAmount", emergencyAmt);
            m.put("baseAmount", baseAmount);
            m.put("daysInMonth", daysInMonth);
            m.put("appliedDays", appliedDays);
            m.put("dailyAmount", dailyAmount);
            m.put("appliedAmount", appliedAmt);
            m.put("payable", payable);
            return m;
        }
    }

    private static final class ScheduleRow {
        final String label;
        final double deduction;
        final double payment;

        ScheduleRow(String label, double deduction, double payment) {
            this.label = label;
            this.deduction = deduction;
            this.payment = payment;
        }

        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("label", label);
            m.put("deduction", deduction);
            m.put("payment", payment);
            return m;
        }
    }
}
