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
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 02_이자소득 — 계산 / 상담기록 / PDF. */
@RestController
@RequestMapping("/api/interest-income")
public class InterestIncomeController {

    @PostMapping("/calc")
    public Result calc(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        List<Map<String, Object>> inputRows = JsonBody.rows(body, "rows");
        if (inputRows.isEmpty()) {
            throw ApiException.badRequest("이자 입력(rows)이 비어 있습니다.");
        }
        String category = JsonBody.str(body, "category");
        double deductionCap = JsonBody.dbl(body, "deductionCap");
        if (deductionCap == 0) {
            Integer cap = Standards.INTEREST_DEDUCTION_CAP.get(category);
            if (cap != null) deductionCap = cap;
        }

        List<CalcRow> rows = new ArrayList<>(inputRows.size());
        for (Map<String, Object> raw : inputRows) {
            CalcRow r = new CalcRow();
            r.account = JsonBody.str(raw, "account");
            r.startMonth = JsonBody.str(raw, "startMonth").trim();
            r.endMonth = JsonBody.str(raw, "endMonth").trim();
            r.amount = JsonBody.dbl(raw, "amount");
            rows.add(r);
        }

        rows.sort(Comparator
                .comparing((CalcRow r) -> r.account)
                .thenComparing(r -> r.startMonth)
                .thenComparing(r -> r.endMonth));

        for (int i = 0; i < rows.size(); i++) {
            rows.get(i).seq = i + 1;
        }

        int maxEnd = -1;
        for (int i = 0; i < rows.size(); i++) {
            CalcRow r = rows.get(i);
            int[] start = parseYearMonth(r.startMonth);
            int[] end = parseYearMonth(r.endMonth);
            if (start == null || end == null) continue;
            int startIdx = start[0] * 12 + (start[1] - 1);
            int endIdx = end[0] * 12 + (end[1] - 1);

            int months = endIdx + 1 - startIdx;
            if (months < 0) months = 0;
            r.months = months;

            int effIdx = startIdx;
            if (i > 0 && maxEnd >= 0 && maxEnd + 1 > effIdx) {
                effIdx = maxEnd + 1;
            }
            int ey = effIdx / 12;
            int em = (effIdx % 12) + 1;
            r.effStartMonth = String.format("%04d-%02d", ey, em);

            int extra;
            if (i == 0) {
                extra = months - 12;
                if (extra < 0) extra = 0;
            } else {
                if (effIdx > endIdx) {
                    extra = 0;
                } else {
                    extra = endIdx + 1 - effIdx;
                }
            }
            r.extraMonths = extra;

            if (endIdx > maxEnd) maxEnd = endIdx;
        }

        double totalE = 0;
        for (CalcRow r : rows) totalE += r.amount;
        double limitCap = totalE - deductionCap;
        if (limitCap < 0) limitCap = 0;
        int cumJ = 0;
        double cumK = 0;
        for (CalcRow r : rows) {
            cumJ += r.extraMonths;
            double rawV = cumJ * deductionCap / 12.0;
            double ru = Math.ceil(rawV);
            double cumNow = Math.min(limitCap, ru);
            double k = cumNow - cumK;
            if (k < 0) k = 0;
            r.deduction = k;
            cumK += k;
        }

        int totalJ = 0;
        double totalK = 0;
        for (CalcRow r : rows) {
            totalJ += r.extraMonths;
            totalK += r.deduction;
        }

        StringBuilder b = new StringBuilder();
        b.append("[이자소득 추가 공제 계산]\n");
        b.append(String.format("* 공제기준액 %s원%n", DomainUtil.formatThousands((long) deductionCap)));
        b.append(String.format("* 이자총액 : %s원%n", DomainUtil.formatThousands((long) totalE)));
        b.append(String.format("* 추가공제월수 : %s개월%n", DomainUtil.formatThousands(totalJ)));
        b.append(String.format("* 총 추가공제금액 : %s원", DomainUtil.formatThousands((long) totalK)));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("category", category);
        data.put("deductionCap", deductionCap);
        data.put("rows", rows.stream().map(CalcRow::toMap).toList());
        data.put("totalAmount", totalE);
        data.put("totalExtraMon", totalJ);
        data.put("totalDeduction", totalK);

        return Result.of("이자소득 추가 공제 계산", b.toString(), data);
    }

    @PostMapping("/record")
    public Result record(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        List<Map<String, Object>> inputRows = JsonBody.rows(body, "rows");
        if (inputRows.isEmpty()) {
            throw ApiException.badRequest("이자 입력(rows)이 비어 있습니다.");
        }
        String category = JsonBody.str(body, "category");
        double deductionCap = JsonBody.dbl(body, "deductionCap");
        if (deductionCap == 0) {
            Integer cap = Standards.INTEREST_DEDUCTION_CAP.get(category);
            if (cap != null) deductionCap = cap;
        }

        record RecordRow(String account, String month, double amount) {}
        List<RecordRow> rows = new ArrayList<>(inputRows.size());
        for (Map<String, Object> raw : inputRows) {
            rows.add(new RecordRow(
                    JsonBody.str(raw, "account"),
                    JsonBody.str(raw, "month"),
                    JsonBody.dbl(raw, "amount")));
        }

        List<String> order = new ArrayList<>();
        Map<String, AcctAgg> byAccount = new LinkedHashMap<>();
        double totalE = 0;
        for (RecordRow row : rows) {
            totalE += row.amount;
            if (row.account == null || row.account.isEmpty()) continue;
            AcctAgg a = byAccount.get(row.account);
            if (a == null) {
                a = new AcctAgg(row.account, row.month, row.month);
                byAccount.put(row.account, a);
                order.add(row.account);
            }
            a.months++;
            a.amount += row.amount;
            if (row.month != null && !row.month.isEmpty()) {
                if (a.firstMonth == null || a.firstMonth.isEmpty() || row.month.compareTo(a.firstMonth) < 0) {
                    a.firstMonth = row.month;
                }
                if (a.lastMonth == null || row.month.compareTo(a.lastMonth) > 0) {
                    a.lastMonth = row.month;
                }
            }
        }

        int totalExtraMonths = 0;
        double totalDeduction = 0;
        double limitCap = totalE - deductionCap;
        if (limitCap < 0) limitCap = 0;
        int cumJ = 0;
        double cumK = 0;

        record AcctRes(String account, int extraMonths, double deduction) {}
        List<AcctRes> results = new ArrayList<>();
        for (String name : order) {
            AcctAgg a = byAccount.get(name);
            int extra = a.months - 12;
            if (extra < 0) extra = 0;
            cumJ += extra;
            double rawV = cumJ * deductionCap / 12.0;
            double ru = Math.ceil(rawV);
            double cumNow = Math.min(limitCap, ru);
            double k = cumNow - cumK;
            if (k < 0) k = 0;
            cumK += k;
            totalExtraMonths += extra;
            totalDeduction += k;
            results.add(new AcctRes(name, extra, k));
        }

        StringBuilder detail = new StringBuilder();
        String lastValidNo = "";
        boolean zeroAll = Math.round(totalE) == Math.round(totalDeduction) && totalDeduction > 0;
        for (int i = 0; i < results.size(); i++) {
            AcctRes res = results.get(i);
            AcctAgg a = byAccount.get(res.account);
            String prefix = results.size() > 1 ? String.format("%d. ", i + 1) : "";
            boolean isZero = res.deduction == 0;
            if (isZero) {
                if (zeroAll) {
                    if (!lastValidNo.isEmpty() && results.size() > 1) {
                        detail.append(String.format("  ※ %s번 추가공제금액으로 이자액총합 전부 공제됨%n", lastValidNo));
                    } else {
                        detail.append("  ※ 추가공제금액으로 이자액총합 전부 공제됨\n");
                    }
                    break;
                }
                String overlap = "이전 기간에 포함됨";
                if (!lastValidNo.isEmpty() && results.size() > 1) {
                    overlap = lastValidNo + "번 기간에 포함됨";
                }
                detail.append(String.format("  %s%s, 추가공제: 없음(%s)%n", prefix, res.account, overlap));
                detail.append(String.format("     - 이자액: %s원, 가입년월: %s, 해지년월: %s%n",
                        DomainUtil.formatThousands((long) a.amount), a.firstMonth, a.lastMonth));
            } else {
                lastValidNo = String.valueOf(i + 1);
                detail.append(String.format("  %s%s, 추가공제월수: %d개월, 추가공제금액: %s원%n",
                        prefix, res.account, res.extraMonths,
                        DomainUtil.formatThousands((long) res.deduction)));
                detail.append(String.format("     - 이자액: %s원, 가입년월: %s, 해지년월: %s%n",
                        DomainUtil.formatThousands((long) a.amount), a.firstMonth, a.lastMonth));
            }
        }

        StringBuilder b = new StringBuilder();
        b.append("[이자소득 추가 공제 확인]\n");
        b.append(String.format("* 공제기준액 %s원%n", DomainUtil.formatThousands((long) deductionCap)));
        b.append(String.format("* 이자총액 : %s원%n", DomainUtil.formatThousands((long) totalE)));
        b.append(String.format("* 추가공제월수 : %s개월%n", DomainUtil.formatThousands(totalExtraMonths)));
        b.append(String.format("* 총 추가공제금액 : %s원%n", DomainUtil.formatThousands((long) totalDeduction)));
        b.append(detail);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("category", category);
        data.put("deductionCap", deductionCap);
        data.put("accounts", order);
        data.put("totalAmount", totalE);
        data.put("totalExtraMon", totalExtraMonths);
        data.put("totalDeduction", totalDeduction);

        String text = b.toString();
        while (text.endsWith("\n")) text = text.substring(0, text.length() - 1);
        return Result.of("이자소득 상담기록", text, data);
    }

    @PostMapping("/pdf")
    public Result pdf(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        List<Map<String, Object>> inputRows = JsonBody.rows(body, "rows");
        if (inputRows.isEmpty()) {
            throw ApiException.badRequest("출력 데이터(rows)가 비어 있습니다.");
        }
        String title = JsonBody.str(body, "title").trim();
        if (title.isEmpty()) title = "이자소득 공제 상담서";

        record PdfRow(String account, String month, double amount, double deducted) {}
        List<PdfRow> rows = new ArrayList<>(inputRows.size());
        for (Map<String, Object> raw : inputRows) {
            rows.add(new PdfRow(
                    JsonBody.str(raw, "account"),
                    JsonBody.str(raw, "month"),
                    JsonBody.dbl(raw, "amount"),
                    JsonBody.dbl(raw, "deducted")));
        }

        double totalAmount = 0;
        double totalDeducted = 0;
        for (PdfRow r : rows) {
            totalAmount += r.amount;
            totalDeducted += r.deducted;
        }

        StringBuilder bd = new StringBuilder();
        bd.append("<table>");
        bd.append("<thead><tr>")
                .append("<th>계좌</th><th>월</th>")
                .append("<th class=\"num\">이자</th><th class=\"num\">차감 후</th>")
                .append("</tr></thead><tbody>");
        for (PdfRow r : rows) {
            bd.append("<tr><td>").append(PrintableHtml.escape(r.account)).append("</td>")
                    .append("<td>").append(PrintableHtml.escape(r.month)).append("</td>")
                    .append("<td class=\"num\">").append(PrintableHtml.escape(DomainUtil.won(r.amount))).append("</td>")
                    .append("<td class=\"num\">").append(PrintableHtml.escape(DomainUtil.won(r.deducted))).append("</td>")
                    .append("</tr>");
        }
        bd.append("</tbody>");
        bd.append("<tfoot><tr><td colspan=\"2\" class=\"total\">합계</td>")
                .append("<td class=\"num total\">").append(PrintableHtml.escape(DomainUtil.won(totalAmount))).append("</td>")
                .append("<td class=\"num total\">").append(PrintableHtml.escape(DomainUtil.won(totalDeducted))).append("</td>")
                .append("</tr></tfoot>");
        bd.append("</table>");

        String doc = PrintableHtml.interestIncome(title, bd.toString());
        String summary = String.format("%s — 행 %d건, 이자합계 %s, 차감 후 합계 %s",
                title, rows.size(), DomainUtil.won(totalAmount), DomainUtil.won(totalDeducted));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("rows", rows);
        data.put("totalAmount", totalAmount);
        data.put("totalDeducted", totalDeducted);

        return Result.html(title, summary, doc, data);
    }

    /** Accepts "YYYY-MM", "YYYY/MM", "YYYY.MM", "YYYY-MM-DD", "YYYYMM" — returns [year, month] or null. */
    static int[] parseYearMonth(String s) {
        if (s == null) return null;
        s = s.trim();
        if (s.length() < 6) return null;
        try {
            if (s.length() >= 7 && (s.charAt(4) == '-' || s.charAt(4) == '/' || s.charAt(4) == '.')) {
                int y = Integer.parseInt(s.substring(0, 4));
                int m = Integer.parseInt(s.substring(5, 7));
                if (y > 0 && m >= 1 && m <= 12) return new int[]{y, m};
            }
            if (s.length() == 6) {
                int y = Integer.parseInt(s.substring(0, 4));
                int m = Integer.parseInt(s.substring(4, 6));
                if (y > 0 && m >= 1 && m <= 12) return new int[]{y, m};
            }
            // fallback: parse as a date
            var d = DomainUtil.parseDate(s);
            return new int[]{d.getYear(), d.getMonthValue()};
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static final class AcctAgg {
        final String account;
        String firstMonth;
        String lastMonth;
        int months;
        double amount;

        AcctAgg(String account, String firstMonth, String lastMonth) {
            this.account = account;
            this.firstMonth = firstMonth;
            this.lastMonth = lastMonth;
        }
    }

    private static final class CalcRow {
        int seq;
        String account;
        String startMonth;
        String endMonth;
        double amount;
        String effStartMonth;
        int months;
        int extraMonths;
        double deduction;

        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("seq", seq);
            m.put("account", account);
            m.put("startMonth", startMonth);
            m.put("endMonth", endMonth);
            m.put("amount", amount);
            m.put("effStartMonth", effStartMonth);
            m.put("months", months);
            m.put("extraMonths", extraMonths);
            m.put("deduction", deduction);
            return m;
        }
    }
}
