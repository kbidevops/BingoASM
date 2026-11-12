package com.bingoasm.service.as;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.Set;

/**
 * 근무 시간 달력: 두 시각 사이의 '근무 시간(분)'을 센다. 근무 요일 · 근무 시간대 안이고 휴일이 아닌 시간만.
 * 근무 시간대는 하루 안 (start &lt; end, 자정을 넘지 않음). 점심시간은 따로 빼지 않는다.
 */
public record WorkCalendar(Set<DayOfWeek> workDays, LocalTime start, LocalTime end, Set<LocalDate> holidays) {

    /** 너무 오래된 건에서 날짜를 끝없이 돌지 않도록 (이보다 길면 그만큼만 센다). */
    private static final int MAX_DAYS = 400;

    public boolean isWorkDay(LocalDate d) {
        return workDays.contains(d.getDayOfWeek()) && !holidays.contains(d);
    }

    /** from ~ to 사이의 근무 시간(분). to가 from보다 이르면 0. */
    public long minutes(LocalDateTime from, LocalDateTime to) {
        if (from == null || to == null || !to.isAfter(from)) return 0;
        LocalDate d = from.toLocalDate(), last = to.toLocalDate();
        if (d.plusDays(MAX_DAYS).isBefore(last)) d = last.minusDays(MAX_DAYS);
        long sec = 0;
        for (; !d.isAfter(last); d = d.plusDays(1)) {
            if (!isWorkDay(d)) continue;
            LocalDateTime ws = d.atTime(start), we = d.atTime(end);
            LocalDateTime a = from.isAfter(ws) ? from : ws, b = to.isBefore(we) ? to : we;
            if (b.isAfter(a)) sec += Duration.between(a, b).getSeconds();
        }
        return sec / 60;
    }

    /** 지금이 근무 시간인가. */
    public boolean isWorkingAt(LocalDateTime t) {
        return isWorkDay(t.toLocalDate()) && !t.toLocalTime().isBefore(start) && t.toLocalTime().isBefore(end);
    }
}
