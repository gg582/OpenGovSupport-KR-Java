package com.opengov.support.web;

/** A4 portrait 인쇄용 HTML 래퍼. 프런트엔드에서 새 탭으로 열어 PDF 저장. */
public final class PrintableHtml {

    private PrintableHtml() {}

    private static final String PRIVATE_HEADER_BG = "#f3efe3";
    private static final String PRIVATE_TOTAL_BG = "#fdf6df";
    private static final String INTEREST_HEADER_BG = "#eef3f8";
    private static final String INTEREST_TOTAL_BG = "#dfe9f5";

    /** 사적이전소득 — yellow palette. */
    public static String privateIncome(String title, String body) {
        return wrap(title, body, PRIVATE_HEADER_BG, PRIVATE_TOTAL_BG);
    }

    /** 이자소득 — blue palette. */
    public static String interestIncome(String title, String body) {
        return wrap(title, body, INTEREST_HEADER_BG, INTEREST_TOTAL_BG);
    }

    private static String wrap(String title, String body, String headerBg, String totalBg) {
        String escapedTitle = escape(title);
        return "<!doctype html>\n"
                + "<html lang=\"ko\"><head><meta charset=\"utf-8\">\n"
                + "<title>" + escapedTitle + "</title>\n"
                + "<style>\n"
                + "@page { size: A4 portrait; margin: 18mm 14mm; }\n"
                + "body { font-family: \"Noto Sans KR\", \"Malgun Gothic\", sans-serif; color:#111; margin:0; padding:24px; }\n"
                + "h1 { font-size: 18pt; margin: 0 0 16px; }\n"
                + "table { width:100%; border-collapse: collapse; font-size: 11pt; }\n"
                + "th, td { border:1px solid #888; padding:6px 8px; text-align:left; }\n"
                + "th { background:" + headerBg + "; }\n"
                + "td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }\n"
                + ".total { font-weight:bold; background:" + totalBg + "; }\n"
                + "@media print { body { padding:0; } button.print { display:none; } }\n"
                + "button.print { float:right; padding:6px 14px; }\n"
                + "</style></head>\n"
                + "<body>\n"
                + "<button class=\"print\" onclick=\"window.print()\">인쇄 / PDF 저장</button>\n"
                + "<h1>" + escapedTitle + "</h1>\n"
                + body + "\n"
                + "</body></html>";
    }

    public static String escape(String s) {
        if (s == null) return "";
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '&' -> out.append("&amp;");
                case '<' -> out.append("&lt;");
                case '>' -> out.append("&gt;");
                case '"' -> out.append("&quot;");
                case '\'' -> out.append("&#39;");
                default -> out.append(c);
            }
        }
        return out.toString();
    }
}
