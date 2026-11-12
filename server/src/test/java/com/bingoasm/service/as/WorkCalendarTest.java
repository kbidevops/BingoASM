package com.bingoasm.service.as;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.EnumSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** 근무 시간(분) 세기. 2026-11-13은 금요일. */
class WorkCalendarTest {
    private static final Set<DayOfWeek> WEEKDAYS = EnumSet.range(DayOfWeek.MONDAY, DayOfWeek.FRIDAY);
    private final WorkCalendar cal = new WorkCalendar(WEEKDAYS, LocalTime.of(9, 0), LocalTime.of(18, 0), Set.of(LocalDate.of(2026, 11, 17)));

    private static LocalDateTime t(int day, int h, int m) { return LocalDateTime.of(2026, 11, day, h, m); }

    @Test void sameDayInsideHours() { assertEquals(90, cal.minutes(t(13, 10, 0), t(13, 11, 30))); }

    @Test void beforeOpeningCountsFromNine() { assertEquals(30, cal.minutes(t(13, 7, 0), t(13, 9, 30))); }

    @Test void afterClosingDoesNotCount() { assertEquals(0, cal.minutes(t(13, 18, 30), t(13, 23, 0))); }

    /** 금 17:00 → 월 10:00 = 금 1시간 + 월 1시간 (주말 제외) */
    @Test void fridayEveningToMondayMorning() { assertEquals(120, cal.minutes(t(13, 17, 0), t(16, 10, 0))); }

    /** 월 17:00 → 수 10:00, 화(17일)는 휴일 = 월 1시간 + 수 1시간 */
    @Test void holidaySkipped() { assertEquals(120, cal.minutes(t(16, 17, 0), t(18, 10, 0))); }

    @Test void weekendOnlyIsZero() { assertEquals(0, cal.minutes(t(14, 9, 0), t(15, 20, 0))); }

    @Test void reversedIsZero() { assertEquals(0, cal.minutes(t(13, 12, 0), t(13, 10, 0))); }

    @Test void fullWeek() { assertEquals(4 * 540, cal.minutes(t(16, 0, 0), t(22, 23, 59))); }
}
