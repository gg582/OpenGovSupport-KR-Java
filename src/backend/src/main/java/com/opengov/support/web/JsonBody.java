package com.opengov.support.web;

import com.opengov.support.domain.DomainUtil;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Map&lt;String, Object&gt; 본문에서 값을 안전하게 꺼내는 헬퍼. */
public final class JsonBody {

    private JsonBody() {}

    public static String str(Map<String, Object> body, String key) {
        if (body == null) return "";
        return DomainUtil.toStr(body.get(key));
    }

    public static double dbl(Map<String, Object> body, String key) {
        if (body == null) return 0;
        return DomainUtil.toDouble(body.get(key));
    }

    public static int integer(Map<String, Object> body, String key) {
        return (int) dbl(body, key);
    }

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> rows(Map<String, Object> body, String key) {
        if (body == null) return Collections.emptyList();
        Object v = body.get(key);
        if (v instanceof List<?> list) {
            return (List<Map<String, Object>>) list;
        }
        return Collections.emptyList();
    }
}
