package com.bingoasm.common;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;

/** Helpers for loosely typed JSON bodies (empty string = null, numbers may arrive as strings). */
public final class Params {
    private Params() {}

    public static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    public static String str(Map<String, Object> body, String key) {
        Object v = body.get(key);
        if (v == null) return null;
        String s = String.valueOf(v).trim();
        return s.isEmpty() ? null : s;
    }

    public static String rawStr(Map<String, Object> body, String key) {
        Object v = body.get(key);
        return v == null ? null : String.valueOf(v);
    }

    public static Long lng(Map<String, Object> body, String key) {
        return toLong(body.get(key));
    }

    public static Integer integer(Map<String, Object> body, String key) {
        Long l = toLong(body.get(key));
        return l == null ? null : l.intValue();
    }

    public static Double dbl(Map<String, Object> body, String key) {
        Object v = body.get(key);
        if (v == null || String.valueOf(v).isBlank()) return null;
        try {
            return v instanceof Number n ? n.doubleValue() : Double.parseDouble(String.valueOf(v));
        } catch (NumberFormatException e) {
            throw ApiException.badRequest("숫자 형식이 올바르지 않습니다: " + key);
        }
    }

    public static Long toLong(Object v) {
        if (v == null || String.valueOf(v).isBlank()) return null;
        try {
            return v instanceof Number n ? n.longValue() : (long) Double.parseDouble(String.valueOf(v));
        } catch (NumberFormatException e) {
            throw ApiException.badRequest("숫자 형식이 올바르지 않습니다.");
        }
    }

    public static LocalDate date(Map<String, Object> body, String key) {
        String s = str(body, key);
        if (s == null) return null;
        try {
            return LocalDate.parse(s.substring(0, Math.min(10, s.length())));
        } catch (Exception e) {
            throw ApiException.badRequest("날짜 형식이 올바르지 않습니다: " + key);
        }
    }

    public static LocalDateTime dateTime(Map<String, Object> body, String key) {
        String s = str(body, key);
        if (s == null) return null;
        try {
            return LocalDateTime.parse(s.length() == 16 ? s + ":00" : s.substring(0, Math.min(19, s.length())));
        } catch (Exception e) {
            throw ApiException.badRequest("일시 형식이 올바르지 않습니다: " + key);
        }
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> map(Map<String, Object> body, String key) {
        Object v = body.get(key);
        return v instanceof Map<?, ?> m ? (Map<String, Object>) m : null;
    }
}
