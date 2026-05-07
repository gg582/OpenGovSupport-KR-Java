package com.opengov.support.web.controller;

import com.opengov.support.domain.Standards;
import com.opengov.support.primitive.DeductionLadderEngine;
import com.opengov.support.primitive.StatutoryResult;
import com.opengov.support.primitive.VatDeltaEngine;
import com.opengov.support.welfare.LegalPriorityTreeEngine;
import com.opengov.support.welfare.MedianIncomeRatioEngine;
import com.opengov.support.welfare.RecognizedIncomeEngine;
import com.opengov.support.welfare.WelfareCalculation;
import com.opengov.support.web.ApiException;
import com.opengov.support.web.JsonBody;
import com.opengov.support.web.Result;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 정통 산식 8 primitive 중 비세무 5종(공제사다리·VAT·소득인정·중위비율·상속우선순위)
 * 을 노출하는 컨트롤러. 모든 응답은 {@link StatutoryResult} 의 5요소를 포함.
 */
@RestController
@RequestMapping("/api/statutory")
public class WelfareEngineController {

    private final WelfareCalculation calc;

    public WelfareEngineController(WelfareCalculation calc) {
        this.calc = calc;
    }

    /** primitive 6 — 소득인정액. */
    @PostMapping("/recognized-income")
    public Result recognizedIncome(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        RecognizedIncomeEngine.Input in = riInput(body);
        StatutoryResult sr = calc.recognizedIncome().evaluate(in);
        return Result.of("소득인정액 산출", text(sr), data(sr));
    }

    /** primitive 7 — 중위소득 비율 + 자격 분기. */
    @PostMapping("/median-ratio")
    public Result medianRatio(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        int year = JsonBody.integer(body, "year");
        if (year == 0) year = Standards.currentYear();
        int hh = JsonBody.integer(body, "householdSize");
        BigDecimal recognized = bd(JsonBody.dbl(body, "recognizedIncome"));
        StatutoryResult sr = calc.medianRatio().evaluate(
                new MedianIncomeRatioEngine.Input(year, hh, recognized));
        return Result.of("중위소득 비율 자격", text(sr), data(sr));
    }

    /** primitive 6 + 7 통합 — 자격 흐름 한 번에. */
    @PostMapping("/eligibility-flow")
    public Result eligibilityFlow(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        int year = JsonBody.integer(body, "year");
        if (year == 0) year = Standards.currentYear();
        int hh = JsonBody.integer(body, "householdSize");
        if (hh <= 0) throw ApiException.badRequest("가구원 수(householdSize)는 1 이상이어야 합니다.");
        int overseasDays = JsonBody.integer(body, "overseasDays");
        String overseasRuleKey = JsonBody.str(body, "overseasRuleKey");
        if (overseasRuleKey.isEmpty()) overseasRuleKey = "기초생활_기존";

        RecognizedIncomeEngine.Input in = riInput(body);
        Map<String, Object> flow = calc.eligibilityFlow(year, hh, in, overseasDays, overseasRuleKey);

        StringBuilder sb = new StringBuilder();
        sb.append("[면책] 본 산출은 법령의 공개 산식을 코드로 평가한 참고 자료이며, ")
                .append("수급 결정의 효력을 갖지 않습니다. 실제 신청은 복지로(보건복지부) 또는 주민센터를 통해 확정하십시오.\n");
        StatutoryResult ri = (StatutoryResult) flow.get("recognizedIncome");
        StatutoryResult mr = (StatutoryResult) flow.get("medianRatio");
        sb.append("[근거 법령] ").append(ri.legalBasis()).append('\n');
        sb.append("[소득인정액] ").append(formatWon(ri.finalOutput())).append('\n');
        sb.append("[중위소득 대비] ").append(mr.finalOutput()).append("%\n");
        sb.append("[해외체류] ").append(flow.get("overseasDays")).append("일 / 임계 ")
                .append(flow.get("overseasThresholdDays")).append("일");
        if (Boolean.TRUE.equals(flow.get("overseasSuspended"))) {
            sb.append(" — 정지\n");
        } else {
            sb.append(" — 정상\n");
        }
        sb.append("[자격] ").append(Boolean.TRUE.equals(flow.get("qualified")) ? "적용 가능" : "적용 불가");

        return Result.of("복지 자격 통합 평가", sb.toString(), flow);
    }

    /** primitive 8 — 법정 상속 우선순위 트리. */
    @PostMapping("/inheritance-priority")
    public Result inheritancePriority(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        LegalPriorityTreeEngine.Input in = new LegalPriorityTreeEngine.Input(
                bd(JsonBody.dbl(body, "totalEstate")),
                JsonBody.integer(body, "spouseCount"),
                JsonBody.integer(body, "childCount"),
                JsonBody.integer(body, "parentCount"),
                JsonBody.integer(body, "siblingCount"),
                JsonBody.integer(body, "fourthDegreeCount"),
                Boolean.parseBoolean(JsonBody.str(body, "substitute")),
                JsonBody.integer(body, "substituteCount"));
        StatutoryResult sr = calc.legalTree().evaluate(in);
        return Result.of("상속 우선순위 산출", text(sr), data(sr));
    }

    /** primitive 5 — VAT 차분. */
    @PostMapping("/vat-delta")
    public Result vatDelta(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        StatutoryResult sr = calc.vatDelta().evaluate(new VatDeltaEngine.Input(
                bd(JsonBody.dbl(body, "salesSupplyAmount")),
                bd(JsonBody.dbl(body, "purchaseSupplyAmount"))));
        return Result.of("부가가치세 납부세액", text(sr), data(sr));
    }

    /** primitive 2 — 근로소득공제 사다리 (사용자 명세 정확값). */
    @PostMapping("/deduction-ladder/earned-income")
    public Result deductionLadderEarnedIncome(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        BigDecimal salary = bd(JsonBody.dbl(body, "salary"));
        StatutoryResult sr = calc.deductionLadder().earnedIncomeDeduction(salary);
        return Result.of("근로소득공제 (사다리)", text(sr), data(sr));
    }

    /** ─── helpers ───────────────────────────────────────────────── */

    private static RecognizedIncomeEngine.Input riInput(Map<String, Object> body) {
        RecognizedIncomeEngine.Region region = parseRegion(JsonBody.str(body, "region"));
        RecognizedIncomeEngine.PropertyMode mode = parseMode(JsonBody.str(body, "propertyMode"));
        return new RecognizedIncomeEngine.Input(
                bd(JsonBody.dbl(body, "salary")),
                bd(JsonBody.dbl(body, "businessIncome")),
                bd(JsonBody.dbl(body, "financialIncome")),
                bd(JsonBody.dbl(body, "rentalIncome")),
                bd(JsonBody.dbl(body, "transferIncome")),
                bd(JsonBody.dbl(body, "generalProperty")),
                bd(JsonBody.dbl(body, "financialAssets")),
                bd(JsonBody.dbl(body, "vehicleAssets")),
                bd(JsonBody.dbl(body, "debt")),
                region,
                mode);
    }

    private static RecognizedIncomeEngine.Region parseRegion(String s) {
        if (s == null || s.isEmpty()) return RecognizedIncomeEngine.Region.OTHER_CITY;
        return switch (s.trim()) {
            case "서울", "SEOUL" -> RecognizedIncomeEngine.Region.SEOUL;
            case "경기", "GYEONGGI" -> RecognizedIncomeEngine.Region.GYEONGGI;
            case "광역세종창원", "METRO" -> RecognizedIncomeEngine.Region.METRO_SEJONG_CHANGWON;
            case "농어촌", "RURAL" -> RecognizedIncomeEngine.Region.RURAL;
            default -> RecognizedIncomeEngine.Region.OTHER_CITY;
        };
    }

    private static RecognizedIncomeEngine.PropertyMode parseMode(String s) {
        if (s == null || s.isEmpty()) return RecognizedIncomeEngine.PropertyMode.GENERAL;
        return switch (s.trim()) {
            case "주거", "주거용", "HOUSING" -> RecognizedIncomeEngine.PropertyMode.HOUSING;
            default -> RecognizedIncomeEngine.PropertyMode.GENERAL;
        };
    }

    private static BigDecimal bd(double v) {
        return BigDecimal.valueOf(v);
    }

    private static String text(StatutoryResult sr) {
        StringBuilder sb = new StringBuilder();
        sb.append("[면책] 본 산출은 법령의 공개 산식을 코드로 평가한 참고 자료이며, 신고·납부·수급의 효력을 갖지 않습니다.\n");
        sb.append("[근거 법령] ").append(sr.legalBasis() == null ? "" : sr.legalBasis()).append('\n');
        sb.append("[정규형] ").append(sr.primitive().name()).append('\n');
        sb.append("[원시 산식] ").append(sr.rawFormula()).append('\n');
        sb.append("[자격] ").append(sr.eligibility().qualified() ? "적용 가능" : "적용 불가").append('\n');
        if (!sr.eligibility().reasons().isEmpty()) {
            sb.append("[사유] ").append(String.join(" / ", sr.eligibility().reasons())).append('\n');
        }
        if (!sr.eligibility().blockers().isEmpty()) {
            sb.append("[블록] ").append(String.join(" / ", sr.eligibility().blockers())).append('\n');
        }
        if (sr.intermediate().get("evaluation") instanceof String eval) {
            sb.append("[대입] ").append(eval).append('\n');
        }
        sb.append("[결과] ").append(formatOutput(sr.finalOutput()));
        return sb.toString();
    }

    private static Map<String, Object> data(StatutoryResult sr) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("primitive", sr.primitive());
        m.put("rawFormula", sr.rawFormula());
        m.put("substitutedVariables", sr.substitutedVariables());
        m.put("finalOutput", sr.finalOutput());
        m.put("legalBasis", sr.legalBasis());
        m.put("eligibility", Map.of(
                "qualified", sr.eligibility().qualified(),
                "reasons", sr.eligibility().reasons(),
                "blockers", sr.eligibility().blockers()));
        m.put("intermediate", sr.intermediate());
        return m;
    }

    private static String formatOutput(Object v) {
        if (v instanceof BigDecimal bd) return formatWon(bd);
        if (v instanceof Number n) return formatWon(BigDecimal.valueOf(n.doubleValue()));
        return v == null ? "0" : v.toString();
    }

    private static String formatWon(Object v) {
        BigDecimal bd = v instanceof BigDecimal x
                ? x
                : v instanceof Number n
                ? BigDecimal.valueOf(n.doubleValue())
                : BigDecimal.ZERO;
        return String.format("%,d원", bd.setScale(0, java.math.RoundingMode.HALF_UP).toBigInteger());
    }
}
