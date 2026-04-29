package com.opengov.support.web.controller;

import com.opengov.support.domain.DomainUtil;
import com.opengov.support.domain.Standards;
import com.opengov.support.web.ApiException;
import com.opengov.support.web.JsonBody;
import com.opengov.support.web.PrintableHtml;
import com.opengov.support.web.Result;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/** 01_사적이전소득 — 계산 / 상담기록 / PDF. */
@RestController
@RequestMapping("/api/private-income")
public class PrivateIncomeController {

    @PostMapping("/calc")
    public Result calc(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        List<Map<String, Object>> inputRows = JsonBody.rows(body, "rows");
        if (inputRows.isEmpty()) {
            throw ApiException.badRequest("입력 데이터(rows)가 비어 있습니다.");
        }

        int year = JsonBody.integer(body, "year");
        if (year == 0) year = Standards.currentYear();
        int household = JsonBody.integer(body, "household");
        if (household < 1) household = 1;
        String altLabel = JsonBody.str(body, "altLabel");
        double thresholdGeneral = JsonBody.dbl(body, "thresholdGeneral");
        double thresholdAlt = JsonBody.dbl(body, "thresholdAlt");
        if (thresholdGeneral == 0) thresholdGeneral = Standards.privateIncomeMonthly(year, household);
        if (thresholdAlt == 0) thresholdAlt = Standards.privateIncomeAlt(year, household);

        List<CalcRow> rows = new ArrayList<>(inputRows.size());
        for (Map<String, Object> raw : inputRows) {
            rows.add(new CalcRow(
                    JsonBody.str(raw, "household"),
                    JsonBody.str(raw, "month"),
                    JsonBody.str(raw, "depositor"),
                    JsonBody.dbl(raw, "amount"),
                    JsonBody.dbl(raw, "exclude")));
        }

        // G열: per-depositor totals (E - F).
        Map<String, Double> totalsByDepositor = new LinkedHashMap<>();
        for (CalcRow row : rows) {
            totalsByDepositor.merge(row.depositor, row.amount - row.exclude, Double::sum);
        }
        Set<String> seen = new HashSet<>();
        for (CalcRow row : rows) {
            String d = row.depositor;
            if (d == null || d.isEmpty() || !seen.add(d)) continue;
            double total = totalsByDepositor.getOrDefault(d, 0.0);
            if (total > 0) {
                row.g = total;
                row.gShown = true;
                double threshold = thresholdGeneral;
                if (altLabel != null && !altLabel.isEmpty() && altLabel.equals(row.household)) {
                    threshold = thresholdAlt;
                }
                double diff = total - threshold;
                row.h = diff <= 0 ? 0 : diff;
                row.hShown = true;
            }
        }

        // Per-depositor summary block.
        List<String> depositorOrder = new ArrayList<>();
        Map<String, Integer> depositorCount = new HashMap<>();
        for (CalcRow row : rows) {
            if (row.depositor == null || row.depositor.isEmpty()) continue;
            if (!depositorCount.containsKey(row.depositor)) depositorOrder.add(row.depositor);
            depositorCount.merge(row.depositor, 1, Integer::sum);
        }
        List<Map<String, Object>> depositors = new ArrayList<>(depositorOrder.size());
        for (String name : depositorOrder) {
            Map<String, Object> dt = new LinkedHashMap<>();
            dt.put("name", name);
            dt.put("amount", totalsByDepositor.getOrDefault(name, 0.0));
            dt.put("count", depositorCount.getOrDefault(name, 0));
            depositors.add(dt);
        }

        double totalAmount = 0;
        double monthlyIncome = 0;
        for (CalcRow row : rows) {
            if (row.gShown) totalAmount += row.g;
            if (row.hShown) monthlyIncome += row.h;
        }
        int supportCount = 0;
        for (Map<String, Object> t : depositors) {
            if ((Double) t.get("amount") > 0) supportCount += (Integer) t.get("count");
        }

        StringBuilder b = new StringBuilder();
        b.append("* 사적이전소득 계산 결과\n");
        for (CalcRow row : rows) {
            if (!row.gShown) continue;
            b.append(String.format("  - %s, %s, %s, 입금 %s, 산출 %s%n",
                    row.household, row.month, row.depositor,
                    DomainUtil.won(row.amount - row.exclude), DomainUtil.won(row.g)));
        }
        b.append(String.format("* 총 산출금액 %s, 지원횟수 %d회%n",
                DomainUtil.won(totalAmount), supportCount));
        b.append(String.format("* 월 사적이전소득 반영금액 %s",
                DomainUtil.won(monthlyIncome)));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("year", year);
        data.put("household", household);
        data.put("thresholdGeneral", thresholdGeneral);
        data.put("thresholdAlt", thresholdAlt);
        data.put("rows", rows.stream().map(CalcRow::toMap).toList());
        data.put("depositors", depositors);
        data.put("totalAmount", totalAmount);
        data.put("supportCount", supportCount);
        data.put("monthlyIncome", monthlyIncome);

        return Result.of("사적이전소득 계산", b.toString(), data);
    }

    @PostMapping("/record")
    public Result record(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        List<Map<String, Object>> inputRows = JsonBody.rows(body, "rows");
        if (inputRows.isEmpty()) {
            throw ApiException.badRequest("계산 결과 행(rows)이 비어 있습니다.");
        }

        record RecordRow(String household, String month, String depositor, double amount, double income) {}
        List<RecordRow> rows = new ArrayList<>(inputRows.size());
        for (Map<String, Object> raw : inputRows) {
            rows.add(new RecordRow(
                    JsonBody.str(raw, "household"),
                    JsonBody.str(raw, "month"),
                    JsonBody.str(raw, "depositor"),
                    JsonBody.dbl(raw, "amount"),
                    JsonBody.dbl(raw, "income")));
        }

        List<String> depositorOrder = new ArrayList<>();
        Map<String, Double> depositorAmount = new LinkedHashMap<>();
        Map<String, Integer> depositorCount = new HashMap<>();
        String householdLabel = "";
        TreeMap<String, Boolean> monthsSet = new TreeMap<>();
        for (RecordRow row : rows) {
            if (row.depositor != null && !row.depositor.isEmpty()) {
                if (!depositorAmount.containsKey(row.depositor)) depositorOrder.add(row.depositor);
                depositorAmount.merge(row.depositor, row.amount, Double::sum);
                depositorCount.merge(row.depositor, 1, Integer::sum);
            }
            if (householdLabel.isEmpty() && row.household != null) {
                householdLabel = row.household;
            }
            if (row.month != null && !row.month.isEmpty()) {
                monthsSet.put(row.month, Boolean.TRUE);
            }
        }

        double totalAmount = 0;
        double monthlyIncome = 0;
        for (RecordRow row : rows) {
            totalAmount += row.amount;
            monthlyIncome += row.income;
        }
        int supportCount = 0;
        for (int v : depositorCount.values()) supportCount += v;

        String startMonth = monthsSet.isEmpty() ? "" : monthsSet.firstKey();

        StringBuilder b = new StringBuilder();
        b.append("* 사적이전소득 조사 결과\n");
        b.append(String.format("* 조사시작년월 : %s, * 가구원수 : %s인%n", startMonth, householdLabel));

        if (!depositorOrder.isEmpty()) {
            StringBuilder parts = new StringBuilder();
            for (int i = 0; i < depositorOrder.size(); i++) {
                if (i > 0) parts.append(", ");
                String name = depositorOrder.get(i);
                parts.append("입금자 ").append(name).append(", ")
                        .append(DomainUtil.formatThousands(Math.round(depositorAmount.getOrDefault(name, 0.0))))
                        .append("원");
            }
            b.append("* ").append(parts).append('\n');
        }
        b.append(String.format("* 총 산출금액 %s원, 지원횟수 %d회%n",
                DomainUtil.formatThousands(Math.round(totalAmount)), supportCount));
        b.append(String.format("* 월 사적이전소득 반영금액 %s원",
                DomainUtil.formatThousands(Math.round(monthlyIncome))));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("depositors", depositorOrder);
        data.put("totalAmount", totalAmount);
        data.put("supportCount", supportCount);
        data.put("monthlyIncome", monthlyIncome);

        return Result.of("사적이전소득 상담기록", b.toString(), data);
    }

    @PostMapping("/pdf")
    public Result pdf(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        List<Map<String, Object>> inputRows = JsonBody.rows(body, "rows");
        if (inputRows.isEmpty()) {
            throw ApiException.badRequest("출력 데이터(rows)가 비어 있습니다.");
        }
        String title = JsonBody.str(body, "title").trim();
        if (title.isEmpty()) title = "사적이전소득 계산서";

        record PdfRow(String household, String month, String depositor, double amount, double income) {}
        List<PdfRow> rows = new ArrayList<>(inputRows.size());
        for (Map<String, Object> raw : inputRows) {
            rows.add(new PdfRow(
                    JsonBody.str(raw, "household"),
                    JsonBody.str(raw, "month"),
                    JsonBody.str(raw, "depositor"),
                    JsonBody.dbl(raw, "amount"),
                    JsonBody.dbl(raw, "income")));
        }

        double totalAmount = 0;
        double totalIncome = 0;
        for (PdfRow r : rows) {
            totalAmount += r.amount;
            totalIncome += r.income;
        }

        StringBuilder bd = new StringBuilder();
        bd.append("<table>");
        bd.append("<thead><tr>")
                .append("<th>가구구분</th><th>입금월</th><th>입금자</th>")
                .append("<th class=\"num\">입금액</th><th class=\"num\">사적이전소득</th>")
                .append("</tr></thead><tbody>");
        for (PdfRow r : rows) {
            bd.append("<tr><td>").append(PrintableHtml.escape(r.household)).append("</td>")
                    .append("<td>").append(PrintableHtml.escape(r.month)).append("</td>")
                    .append("<td>").append(PrintableHtml.escape(r.depositor)).append("</td>")
                    .append("<td class=\"num\">").append(PrintableHtml.escape(DomainUtil.won(r.amount))).append("</td>")
                    .append("<td class=\"num\">").append(PrintableHtml.escape(DomainUtil.won(r.income))).append("</td>")
                    .append("</tr>");
        }
        bd.append("</tbody>");
        bd.append("<tfoot><tr><td colspan=\"3\" class=\"total\">합계</td>")
                .append("<td class=\"num total\">").append(PrintableHtml.escape(DomainUtil.won(totalAmount))).append("</td>")
                .append("<td class=\"num total\">").append(PrintableHtml.escape(DomainUtil.won(totalIncome))).append("</td>")
                .append("</tr></tfoot>");
        bd.append("</table>");

        String doc = PrintableHtml.privateIncome(title, bd.toString());
        String summary = String.format("%s — 행 %d건, 입금합계 %s, 사적이전소득 %s",
                title, rows.size(), DomainUtil.won(totalAmount), DomainUtil.won(totalIncome));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("rows", rows);
        data.put("totalAmount", totalAmount);
        data.put("totalIncome", totalIncome);

        return Result.html(title, summary, doc, data);
    }

    private static final class CalcRow {
        final String household;
        final String month;
        final String depositor;
        final double amount;
        final double exclude;
        double g;
        boolean gShown;
        double h;
        boolean hShown;

        CalcRow(String household, String month, String depositor, double amount, double exclude) {
            this.household = household;
            this.month = month;
            this.depositor = depositor;
            this.amount = amount;
            this.exclude = exclude;
        }

        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("household", household);
            m.put("month", month);
            m.put("depositor", depositor);
            m.put("amount", amount);
            m.put("exclude", exclude);
            m.put("g", g);
            m.put("gShown", gShown);
            m.put("h", h);
            m.put("hShown", hShown);
            return m;
        }
    }
}
