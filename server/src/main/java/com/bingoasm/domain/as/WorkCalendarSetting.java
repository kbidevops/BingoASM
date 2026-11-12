package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** 근무 시간 달력 (V14): 교육청마다 한 줄. 없으면 월~금 09:00~18:00. */
@Entity
@Table(name = "work_calendars")
public class WorkCalendarSetting {
    @Id
    public Long orgId;
    /** ISO 요일 1(월) ~ 7(일), 쉼표로 */
    @Column(length = 20, nullable = false)
    public String workDays = "1,2,3,4,5";
    @Column(length = 5, nullable = false)
    public String startTime = "09:00";
    @Column(length = 5, nullable = false)
    public String endTime = "18:00";
    public LocalDateTime updatedAt;
    public Long updatedBy;
}
