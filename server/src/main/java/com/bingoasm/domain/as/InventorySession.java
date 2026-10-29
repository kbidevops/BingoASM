package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** 재물조사 회차. */
@Entity
@Table(name = "inventory_sessions", indexes = @Index(columnList = "schoolId"))
public class InventorySession {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long sessionId;
    public Long orgId;
    public Long schoolId;
    @Column(length = 100)
    public String title;
    public Long startedBy;
    public LocalDateTime startedAt;
    public LocalDateTime endedAt;
    /** OPEN / CLOSED */
    @Column(length = 10)
    public String status = "OPEN";
    /** 완료 처리한 실 ID 목록 (콤마) */
    @Column(length = 2000)
    public String doneRoomIds = "";
}
