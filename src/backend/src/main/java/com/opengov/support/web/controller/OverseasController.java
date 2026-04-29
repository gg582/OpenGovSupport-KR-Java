package com.opengov.support.web.controller;

import com.opengov.support.domain.DomainUtil;
import com.opengov.support.web.ApiException;
import com.opengov.support.web.JsonBody;
import com.opengov.support.web.Result;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 06_해외체류 — 신규/기존 신청자 + 기초·장애인 연금 + 차상위 본인부담경감. */
@RestController
@RequestMapping("/api/overseas")
public class OverseasController {

    @PostMapping("/new")
    public Result newApplicant(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        String applicationDate = JsonBody.str(body, "applicationDate");
        LocalDate appDate;
        try {
            appDate = DomainUtil.parseDate(applicationDate);
        } catch (RuntimeException e) {
            throw ApiException.badRequest("보장결정일이 올바른 날짜가 아닙니다.");
        }
        LocalDate day180 = appDate.plusDays(180);

        TripResult tr = computeTripDays(JsonBody.rows(body, "trips"), appDate, LocalDate.now());

        StringBuilder records = new StringBuilder();
        for (TripRow row : tr.rows) {
            records.append(String.format("  - %s ~ %s (%d일)%n",
                    row.departure, row.arrivalLabel, row.days));
        }
        if (records.length() == 0) {
            records.append("  (출입국 기록 없음)\n");
        }
        String str61 = tr.found61
                ? DomainUtil.formatKDate(tr.day61)
                : "해당 없음 (현재 총 " + tr.total + "일)";

        String text = String.format(
                "해외체류 일수 확인%n" +
                        "* 보장결정일 : %s%n" +
                        "* 180일 도래일 : %s%n" +
                        "* 출입국 기록 : [총합 : %d일]%n" +
                        "%s" +
                        "* 61일째 되는날 : %s",
                applicationDate, DomainUtil.formatKDate(day180),
                tr.total, records, str61);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("trips", tr.rows.stream().map(TripRow::toMap).toList());
        data.put("totalDays", tr.total);
        data.put("day180", DomainUtil.formatKDate(day180));
        data.put("day61", str61);
        return Result.of("신규 신청자 해외체류", text, data);
    }

    @PostMapping("/existing")
    public Result existing(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        LocalDate baseline;
        try {
            baseline = DomainUtil.parseDate(JsonBody.str(body, "baselineDate"));
        } catch (RuntimeException e) {
            throw ApiException.badRequest("기준일이 올바른 날짜가 아닙니다.");
        }
        LocalDate notice = LocalDate.now();
        String noticeDate = JsonBody.str(body, "noticeDate");
        if (!noticeDate.isEmpty()) {
            try {
                notice = DomainUtil.parseDate(noticeDate);
            } catch (RuntimeException ignored) {
                // keep default
            }
        }
        TripResult tr = computeTripDays(JsonBody.rows(body, "trips"), baseline, notice);

        StringBuilder records = new StringBuilder();
        for (TripRow row : tr.rows) {
            records.append(String.format("  - %s ~ %s (%d일)%n",
                    row.departure, row.arrivalLabel, row.days));
        }
        if (records.length() == 0) {
            records.append("  (출입국 기록 없음)\n");
        }
        String str61 = tr.found61
                ? DomainUtil.formatKDate(tr.day61)
                : "해당 없음 (현재 총 " + tr.total + "일)";

        String text = String.format(
                "해외체류 일수 확인%n" +
                        "* 행복이음 통보일 : %s%n" +
                        "* 역산 180일 : %s%n" +
                        "* 출입국 기록 : [총합 : %d일] %n" +
                        "%s" +
                        "* 61일째 되는날 : %s",
                DomainUtil.formatKDate(notice), DomainUtil.formatKDate(baseline),
                tr.total, records, str61);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("trips", tr.rows.stream().map(TripRow::toMap).toList());
        data.put("totalDays", tr.total);
        data.put("day61", str61);
        return Result.of("기존 수급자 해외체류", text, data);
    }

    @PostMapping("/pension")
    public Result pension(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        LocalDate dep;
        try {
            dep = DomainUtil.parseDate(JsonBody.str(body, "departureDate"));
        } catch (RuntimeException e) {
            throw ApiException.badRequest("출국일이 올바른 날짜가 아닙니다.");
        }
        LocalDate target = dep.plusDays(61);
        String pensionType = JsonBody.str(body, "pensionType").trim();

        String titleText;
        String tailText;
        switch (pensionType) {
            case "기초연금" -> {
                titleText = "[기초연금 60일경과 연속 출국자 급여정지]";
                tailText = "* 급여정지한 달까지 지급, 입국한 다음달부터 지급";
            }
            case "장애인연금" -> {
                titleText = "[장애인연금 60일경과 연속 출국자 일시정지]";
                tailText = "* 일시정지한 달까지 지급, 입국한 다음달부터 지급";
            }
            case "기초+장애인 모두", "기초연금 및 장애인연금" -> {
                titleText = "[기초연금(급여정지) 및 장애인연금(일시정지) 60일경과 연속 출국자]";
                tailText = "* 급여정지(일시정지)한 달까지 지급, 입국한 다음달부터 지급";
            }
            default -> {
                titleText = pensionType.isEmpty()
                        ? "[60일경과 연속 출국자 정지]"
                        : "[" + pensionType + " 60일경과 연속 출국자 정지]";
                tailText = "* 정지한 달까지 지급, 입국한 다음달부터 지급";
            }
        }

        String text = String.format("%s%n* 출국일 : %s%n* 61일째 되는날 : %s%n%s",
                titleText, DomainUtil.formatKDate(dep), DomainUtil.formatKDate(target), tailText);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("departure", DomainUtil.formatKDate(dep));
        data.put("target", DomainUtil.formatKDate(target));
        return Result.of("기초/장애인 연금 — 60일 경과", text, data);
    }

    @PostMapping("/care")
    public Result care(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        LocalDate dep;
        try {
            dep = DomainUtil.parseDate(JsonBody.str(body, "departureDate"));
        } catch (RuntimeException e) {
            throw ApiException.badRequest("출국일이 올바른 날짜가 아닙니다.");
        }
        LocalDate target = DomainUtil.addMonths(dep, 3);
        String text = String.format(
                "[차상위본인부담경감 3개월 이상 연속 출국자 중지 요청]%n" +
                        "* 출국일 : %s%n" +
                        "* 3개월 경과일 : %s",
                DomainUtil.formatKDate(dep), DomainUtil.formatKDate(target));
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("departure", DomainUtil.formatKDate(dep));
        data.put("target", DomainUtil.formatKDate(target));
        return Result.of("차상위 본인부담경감", text, data);
    }

    /** 각 출국 건에 대해 baseline 으로 클램프한 일수 계산. 누적이 61일을 넘기면 그 시점 일자 기록. */
    private static TripResult computeTripDays(
            List<Map<String, Object>> trips, LocalDate baseline, LocalDate fallbackArrival) {
        List<TripRow> rows = new ArrayList<>();
        int total = 0;
        LocalDate day61 = null;
        boolean found61 = false;
        for (Map<String, Object> t : trips) {
            String departure = JsonBody.str(t, "departure");
            String arrival = JsonBody.str(t, "arrival");
            LocalDate dep;
            try {
                dep = DomainUtil.parseDate(departure);
            } catch (RuntimeException e) {
                continue;
            }
            LocalDate calcDep = dep;
            if (calcDep.isBefore(baseline)) {
                calcDep = baseline.minusDays(1);
            }
            int days;
            String arrLabel;
            String trimmedArr = arrival == null ? "" : arrival.trim();
            LocalDate arr = null;
            try {
                if (!trimmedArr.isEmpty()) arr = DomainUtil.parseDate(trimmedArr);
            } catch (RuntimeException e) {
                arr = null;
            }
            if (arr == null) {
                arrLabel = "미입국";
                days = (int) ChronoUnit.DAYS.between(calcDep, fallbackArrival);
            } else {
                arrLabel = DomainUtil.formatKDate(arr);
                days = (int) ChronoUnit.DAYS.between(calcDep, arr) - 1;
            }
            if (days < 0) days = 0;

            rows.add(new TripRow(DomainUtil.formatKDate(dep), arrival == null ? "" : arrival, days, arrLabel));

            if (!found61 && total + days >= 61) {
                int daysNeeded = 61 - total;
                day61 = calcDep.plusDays(daysNeeded - 1);
                found61 = true;
            }
            total += days;
        }
        return new TripResult(rows, total, day61, found61);
    }

    private record TripRow(String departure, String arrival, int days, String arrivalLabel) {
        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("departure", departure);
            m.put("arrival", arrival);
            m.put("days", days);
            m.put("arrivalLabel", arrivalLabel);
            return m;
        }
    }

    private record TripResult(List<TripRow> rows, int total, LocalDate day61, boolean found61) {}
}
