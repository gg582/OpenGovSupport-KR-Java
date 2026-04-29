package com.opengov.support.web.controller;

import com.opengov.support.domain.DomainUtil;
import com.opengov.support.domain.Standards;
import com.opengov.support.domain.Standards.InheritanceShare;
import com.opengov.support.web.ApiException;
import com.opengov.support.web.JsonBody;
import com.opengov.support.web.Result;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/** 04_상속상담 — 「민법」 제1009조 법정 상속분 산출. */
@RestController
@RequestMapping("/api/inheritance")
public class InheritanceController {

    @PostMapping("/consult")
    public Result consult(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) body = Map.of();

        String target = JsonBody.str(body, "target");
        double totalAmount = JsonBody.dbl(body, "totalAmount");
        int spouseCount = JsonBody.integer(body, "spouseCount");
        int childCount = JsonBody.integer(body, "childCount");
        int parentCount = JsonBody.integer(body, "parentCount");

        if (childCount >= 1 && parentCount >= 1) {
            throw ApiException.badRequest("자녀와 부모는 동시에 상속을 할 수 없습니다. 확인 바랍니다.");
        }

        InheritanceShare share = Standards.computeInheritance(totalAmount, spouseCount, childCount, parentCount);

        StringBuilder sb = new StringBuilder();
        sb.append("[상속 지분 계산]\n");
        sb.append("* 대상물건: ").append(target).append('\n');
        sb.append("* 상속가액: ").append(DomainUtil.won(totalAmount)).append('\n');
        sb.append("* 상속지분 (배우자 1.5 : 직계 1.0)\n");

        if (spouseCount >= 1) {
            sb.append("  - 배우자 ").append(spouseCount).append("명: ")
                    .append(DomainUtil.won(share.spouseShare() * spouseCount))
                    .append(" (1인 ").append(DomainUtil.won(share.spouseShare())).append(")\n");
        } else {
            sb.append("  - 배우자: 없음\n");
        }

        if (childCount >= 1) {
            sb.append("  - 자녀 ").append(childCount).append("명: ")
                    .append(DomainUtil.won(share.childTotal()))
                    .append(" (자녀1인지분: ").append(DomainUtil.won(share.childPer())).append(")\n");
        } else if (parentCount >= 1) {
            sb.append("  - 부모 ").append(parentCount).append("명: ")
                    .append(DomainUtil.won(share.parentTotal()))
                    .append(" (부모1인지분: ").append(DomainUtil.won(share.parentPer())).append(")\n");
        } else {
            sb.append("  - 자녀/부모: 없음\n");
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("target", target);
        data.put("totalAmount", totalAmount);
        data.put("spouse", Map.of(
                "count", spouseCount,
                "share", share.spouseShare(),
                "total", share.spouseShare() * spouseCount));
        data.put("child", Map.of(
                "count", childCount,
                "total", share.childTotal(),
                "per", share.childPer()));
        data.put("parent", Map.of(
                "count", parentCount,
                "total", share.parentTotal(),
                "per", share.parentPer()));

        return Result.of("상속 지분 안내", sb.toString(), data);
    }
}
