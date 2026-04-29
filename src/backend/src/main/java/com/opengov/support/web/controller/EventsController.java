package com.opengov.support.web.controller;

import com.opengov.support.domain.DomainUtil;
import com.opengov.support.web.JsonBody;
import com.opengov.support.web.Result;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 00_workbook_events — 재산변동상담생성 화면 행 숨김/표시 + 차액 자동계산 시뮬레이션. */
@RestController
@RequestMapping("/api/events")
public class EventsController {

    @PostMapping("/property-sheet")
    public Result propertySheet(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();
        String mode = JsonBody.str(body, "mode").trim();
        double c8 = JsonBody.dbl(body, "c8");
        double c9 = JsonBody.dbl(body, "c9");
        double c13 = JsonBody.dbl(body, "c13");
        double c14 = JsonBody.dbl(body, "c14");

        List<String> visible = List.of("2:21");
        List<String> hidden = switch (mode) {
            case "금융재산" -> List.of("5:6", "11:17");
            case "일반재산" -> List.of("5:6", "8:10", "13:17");
            case "주택조사결과" -> List.of("8:12");
            case "선택" -> List.of("4:21");
            default -> List.of();
        };

        double c10 = c9 - c8;
        double c17 = c14 - c13;

        StringBuilder sb = new StringBuilder();
        sb.append("[재산변동상담생성 시트 시뮬레이션]\n");
        sb.append("* C3 모드 : ").append(mode).append('\n');
        sb.append("* 표시되는 행 : ").append(String.join(",", visible)).append('\n');
        if (!hidden.isEmpty()) {
            sb.append("* 숨겨지는 행 : ").append(String.join(",", hidden)).append('\n');
        }
        sb.append("* C10 (= C9 - C8) : ").append(DomainUtil.won(c10)).append('\n');
        sb.append("* C17 (= C14 - C13) : ").append(DomainUtil.won(c17)).append('\n');

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("mode", mode);
        data.put("c10", c10);
        data.put("c17", c17);
        data.put("hidden", hidden);
        data.put("visible", visible);

        return Result.of("재산변동상담생성 시트 동작", sb.toString(), data);
    }
}
