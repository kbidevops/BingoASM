package com.bingoasm.common;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Fixed-window limiter for login endpoints: 20 attempts per minute per client IP. */
@Component
public class RateLimiter {
    private record Window(long minute, int count) {}
    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    public void check(String key, int limitPerMinute) {
        long minute = System.currentTimeMillis() / 60000;
        Window w = windows.compute(key, (k, old) -> old == null || old.minute != minute ? new Window(minute, 1) : new Window(minute, old.count + 1));
        if (windows.size() > 50_000) windows.entrySet().removeIf(e -> e.getValue().minute != minute);
        if (w.count > limitPerMinute) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
    }
}
