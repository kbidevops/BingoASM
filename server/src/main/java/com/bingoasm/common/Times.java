package com.bingoasm.common;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

public final class Times {
    private Times() {}

    public static LocalDateTime now() {
        return LocalDateTime.now().truncatedTo(ChronoUnit.MICROS);
    }

    public static LocalDate today() {
        return LocalDate.now();
    }
}
