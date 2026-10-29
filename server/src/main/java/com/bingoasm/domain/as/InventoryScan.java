package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** 재물조사 스캔 1건. result: FOUND 확인 / MOVED 다른 실에서 발견 / UNKNOWN 미등록 */
@Entity
@Table(name = "inventory_scans", indexes = {@Index(columnList = "sessionId"), @Index(columnList = "assetId")})
public class InventoryScan {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long scanId;
    public Long sessionId;
    public Long roomId;
    @Column(length = 50)
    public String assetNo;
    public Long assetId;
    @Column(length = 10)
    public String result;
    public Long fromRoomId;
    public Boolean applied = false;
    public Long scannedBy;
    public LocalDateTime scannedAt;
}
