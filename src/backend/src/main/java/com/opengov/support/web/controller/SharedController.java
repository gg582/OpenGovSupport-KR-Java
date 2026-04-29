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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 99_공용 — 개월수계산 / 초기 차감금액 계산. */
@RestController
@RequestMapping("/api/shared")
public class SharedController {

    @PostMapping("/months")
    public Result months(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        LocalDate start = parseOr(body, "startDate", "시작일이 올바른 날짜가 아닙니다.");
        LocalDate end = parseOr(body, "endDate", "종료일이 올바른 날짜가 아닙니다.");
        int months = DomainUtil.monthsBetween(start, end);
        return Result.of(
                "개월수 계산 결과",
                String.format("%s ~ %s : %d개월", DomainUtil.formatKDate(start), DomainUtil.formatKDate(end), months),
                Map.of("months", months));
    }

    @PostMapping("/initial-deduction")
    public Result initialDeduction(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        String category = JsonBody.str(body, "category");
        double principal = JsonBody.dbl(body, "principal");

        LocalDate baseline = parseOr(body, "baselineDate", "기준일이 올바른 날짜가 아닙니다.");
        LocalDate current = parseOr(body, "currentDate", "조사일이 올바른 날짜가 아닙니다.");

        int startY = baseline.getYear();
        int endY = current.getYear();
        if (endY < startY) {
            throw ApiException.badRequest("조사일이 기준일보다 빠릅니다.");
        }

        List<Map<String, Object>> breakdown = new ArrayList<>();
        int totalMonths = 0;
        double total = 0;
        for (int y = startY; y <= endY; y++) {
            int months = monthsInYear(y, baseline, current);
            CategoryHit hit = lookupCategory(category, y);
            double sub = switch (hit.kind) {
                case "rate" -> principal * hit.value * months;
                case "amount" -> hit.value * months;
                default -> 0;
            };
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("year", y);
            row.put("months", months);
            row.put("value", hit.value);
            row.put("amount", sub);
            breakdown.add(row);
            totalMonths += months;
            total += sub;
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("category", category);
        data.put("months", totalMonths);
        data.put("deduction", total);
        data.put("principal", principal);
        data.put("breakdown", breakdown);

        String text = String.format(
                "기준일 %s ~ 조사일 %s%n* 항목 : %s%n* 누적 개월수 : %d개월%n* 누적 차감액 : %s",
                DomainUtil.formatKDate(baseline), DomainUtil.formatKDate(current),
                category, totalMonths, DomainUtil.won(total));
        return Result.of("초기 차감 금액", text, data);
    }

    private static int monthsInYear(int year, LocalDate baseline, LocalDate current) {
        int bY = baseline.getYear();
        int cY = current.getYear();
        int bM = baseline.getMonthValue();
        int cM = current.getMonthValue();
        if (year == bY && year == cY) return cM - bM + 1;
        if (year == bY) return 12 - bM + 1;
        if (year == cY) return cM;
        return 12;
    }

    private static CategoryHit lookupCategory(String category, int year) {
        if ("기타증여재산".equals(category)) {
            Double r = Standards.OTHER_GIFT_RATE.get(year);
            if (r != null) return new CategoryHit(r, "rate");
            return new CategoryHit(0, "");
        }
        int n = parseHouseholdSuffix(category, "맞춤형 ");
        if (n > 0) {
            Map<Integer, Integer> table = Standards.CUSTOM_BASE_AMOUNT.get(year);
            Integer a = table == null ? null : table.get(n);
            if (a != null) return new CategoryHit(a, "amount");
        }
        n = parseHouseholdSuffix(category, "기초연금 ");
        if (n > 0) {
            Map<Integer, Integer> table = Standards.CUSTOM_BASE_AMOUNT.get(year);
            Integer a = table == null ? null : table.get(n);
            if (a != null) return new CategoryHit(a, "amount");
        }
        return new CategoryHit(0, "");
    }

    private static int parseHouseholdSuffix(String s, String prefix) {
        if (s == null || s.length() <= prefix.length() || !s.startsWith(prefix)) return 0;
        String rest = s.substring(prefix.length());
        String tail = "인";
        if (rest.length() <= tail.length() || !rest.endsWith(tail)) return 0;
        String num = rest.substring(0, rest.length() - tail.length());
        int n = 0;
        for (int i = 0; i < num.length(); i++) {
            char c = num.charAt(i);
            if (c < '0' || c > '9') return 0;
            n = n * 10 + (c - '0');
        }
        return n;
    }

    private static LocalDate parseOr(Map<String, Object> body, String key, String errMsg) {
        try {
            return DomainUtil.parseDate(JsonBody.str(body, key));
        } catch (RuntimeException e) {
            throw ApiException.badRequest(errMsg);
        }
    }

    private record CategoryHit(double value, String kind) {}
}
