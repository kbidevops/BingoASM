package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDate;

/** 휴일 (V14): 근무 요일이어도 근무 시간으로 세지 않는 날 (공휴일 · 대체공휴일 · 재량휴업일 등). */
@Entity
@Table(name = "holidays", uniqueConstraints = @UniqueConstraint(name = "uk_holidays", columnNames = {"orgId", "holidayDate"}))
public class Holiday {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long holidayId;
    @Column(nullable = false)
    public Long orgId;
    @Column(nullable = false)
    public LocalDate holidayDate;
    @Column(length = 50)
    public String name;
}
