package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** 스쿨넷 SLA 기준 (V10): 교육청마다 한 줄. 시간은 신청 시각부터 잰 분. */
@Entity
@Table(name = "sla_targets")
public class SlaTarget {
    @Id
    public Long orgId;
    /** 신청 → 접수 */
    @Column(nullable = false)
    public Integer receiveMin = 30;
    /** 신청 → 현장 도착(방문) */
    @Column(nullable = false)
    public Integer visitMin = 240;
    /** 신청 → 처리완료: 전체 장애(장애유형 71) */
    @Column(nullable = false)
    public Integer recoverFullMin = 480;
    /** 신청 → 처리완료: 일부 · 기타 장애 */
    @Column(nullable = false)
    public Integer recoverPartialMin = 1440;
    /** 회선 월 가용률 목표 (%) */
    @Column(nullable = false)
    public Double availabilityPct = 99.5;
    public LocalDateTime updatedAt;
    public Long updatedBy;
}
