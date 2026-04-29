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
import java.util.LinkedHashMap;
import java.util.Map;

/** 03_재산상담 — 재산변동(금융/일반/주택조사)에 대한 상담 메시지 생성. */
@RestController
@RequestMapping("/api/property")
public class PropertyController {

    @PostMapping("/consult")
    public Result consult(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();

        int year = JsonBody.integer(body, "year");
        if (year == 0) year = Standards.currentYear();
        String mode = JsonBody.str(body, "mode").trim();
        double previous = JsonBody.dbl(body, "previous");
        double current = JsonBody.dbl(body, "current");
        String baselineDate = JsonBody.str(body, "baselineDate");
        String currentDate = JsonBody.str(body, "currentDate");
        String category = JsonBody.str(body, "category");
        double deductionRate = JsonBody.dbl(body, "deductionRate");
        if (deductionRate == 0) {
            Double v = Standards.OTHER_GIFT_RATE.get(year);
            if (v != null) deductionRate = v;
        }
        double monthlyDeduction = JsonBody.dbl(body, "monthlyDeduction");

        Inputs in = new Inputs(year, mode, previous, current, baselineDate, currentDate,
                category, deductionRate, monthlyDeduction);

        String title;
        String text;
        switch (mode) {
            case "금융재산" -> {
                title = "[금융재산 기타증여재산]";
                text = financialMessage(in);
            }
            case "일반재산" -> {
                title = "[일반재산 기타증여재산]";
                text = generalPropertyMessage(in);
            }
            case "주택조사결과" -> {
                title = "주택조사결과 반영";
                text = housingMessage(in);
            }
            default -> throw ApiException.badRequest("C3에 선택된 값이 없습니다.");
        }

        double diff = current - previous;
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("year", year);
        data.put("mode", mode);
        data.put("previous", previous);
        data.put("current", current);
        data.put("diff", diff);
        data.put("category", category);
        data.put("baselineDate", baselineDate);
        data.put("currentDate", currentDate);
        data.put("deductionRate", deductionRate);
        data.put("monthlyDeduction", monthlyDeduction);
        return Result.of(title, text, data);
    }

    private static String financialMessage(Inputs in) {
        double diff = in.current - in.previous;
        StringBuilder b = new StringBuilder();
        b.append("[금융재산 기타증여재산]");
        b.append("\r\n");
        b.append("* 금회 ").append(DomainUtil.won(in.current));
        b.append(" 직전 ").append(DomainUtil.won(in.previous));
        b.append(" 차액 ").append(DomainUtil.won(diff));
        b.append(" 기준일자 ").append(in.currentDate);
        b.append(commonDeductionSection(in, diff));
        return b.toString();
    }

    private static String generalPropertyMessage(Inputs in) {
        double diff = in.current;
        StringBuilder b = new StringBuilder();
        b.append("[일반재산 기타증여재산]");
        b.append("\r\n");
        b.append("* 대상물건: ").append(in.category);
        b.append("\r\n");
        b.append("* 처분금액 ").append(DomainUtil.won(diff))
                .append(", 처분일자 ").append(in.currentDate);
        b.append(commonDeductionSection(in, diff));
        return b.toString();
    }

    private static String housingMessage(Inputs in) {
        double diff = in.current - in.previous;
        StringBuilder b = new StringBuilder();
        b.append(in.category).append("에 따른 주택조사결과 반영");
        b.append("\r\n\r\n");

        if (in.category != null && in.category.contains("신규신청")) {
            b.append("* 금회 ").append(DomainUtil.won(in.current));
            return b.toString();
        }

        b.append("* 금회 ").append(DomainUtil.won(in.current));
        b.append(", 직전 ").append(DomainUtil.won(in.previous));

        if (diff > 0) {
            b.append("  차액 ").append(DomainUtil.won(diff))
                    .append(" 기준일자 ").append(in.currentDate);
            b.append(commonDeductionSection(in, diff));
        }

        b.append("\r\n");
        if (in.current == in.previous) {
            b.append("\r\n소득인정액 ").append(DomainUtil.won(in.current)).append(" 변경 없음");
        } else {
            b.append("\r\n소득인정액 금회 ").append(DomainUtil.won(in.current))
                    .append(" 직전 ").append(DomainUtil.won(in.previous));
            if (in.current < in.previous) {
                b.append(" 감소함");
            } else {
                b.append(" 증가함");
            }
        }
        return b.toString();
    }

    private static String commonDeductionSection(Inputs in, double target) {
        StringBuilder b = new StringBuilder();

        boolean hasExtra = false;
        double otherDeduction = 0.0;
        if (in.monthlyDeduction > 0) {
            hasExtra = true;
            otherDeduction = in.monthlyDeduction;
            b.append("\r\n* 기타차감 ").append(DomainUtil.won(in.monthlyDeduction));
        }

        int yearC2 = 0;
        int yearC7 = 0;
        LocalDate bDate = tryParse(in.baselineDate);
        LocalDate cDate = tryParse(in.currentDate);
        if (bDate != null) yearC2 = bDate.getYear();
        if (cDate != null) yearC7 = cDate.getYear();

        boolean manualMode = yearC2 > 0 && yearC7 > 0 && yearC7 <= yearC2 - 2;

        if (manualMode) {
            double hypothetical = 0;
            if (cDate != null) {
                LocalDate hypoStart = LocalDate.of(yearC2 - 1, 1, 1);
                int months = DomainUtil.monthsBetween(hypoStart, cDate);
                if (months < 0) months = 0;
                hypothetical = in.deductionRate * in.previous * months;
            }
            double grandTotal = hypothetical + otherDeduction;

            if (target <= grandTotal) {
                b.append("\r\n* ").append(yearC2 - 1)
                        .append("년 1월 기준 초기차감금액 ")
                        .append(DomainUtil.won(hypothetical))
                        .append("으로 기준일자까지 계산하지 않아도 차액이 차감금액보다 적어 반영하지 않음");
            } else if (hasExtra) {
                b.append("\r\n* 초기차감금액(행복이음 계산 후 수기입력)원, 총 차감금액( )원 (반영함/으로 차금금액보다 적어 반영하지 않음)");
            } else {
                b.append("\r\n* 초기차감금액(행복이음 계산 후 수기입력)원 (반영함/으로 차금금액보다 적어 반영하지 않음)");
            }
            return b.toString();
        }

        double initialDeduction = 0.0;
        if (bDate != null && cDate != null) {
            int months = DomainUtil.monthsBetween(bDate, cDate);
            if (months < 0) months = 0;
            initialDeduction = in.deductionRate * in.previous * months;
        }
        double totalDeduction = initialDeduction + otherDeduction;

        b.append("\r\n* 초기차감금액 ").append(DomainUtil.won(initialDeduction));
        if (hasExtra) {
            b.append(", 총 차감금액 ").append(DomainUtil.won(totalDeduction));
        }
        if (target > totalDeduction) {
            b.append(" 반영함");
        } else {
            b.append("으로 차감금액보다 적어 반영하지 않음");
        }
        return b.toString();
    }

    private static LocalDate tryParse(String s) {
        try {
            return DomainUtil.parseDate(s);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private record Inputs(
            int year,
            String mode,
            double previous,
            double current,
            String baselineDate,
            String currentDate,
            String category,
            double deductionRate,
            double monthlyDeduction) {}
}
