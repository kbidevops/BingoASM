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
    /** 단계마다 시간 세는 법 (V19): true = 근무 시간 달력(알림과 같은 달력)으로, false = 24시간. 가용률은 늘 24시간. */
    @Column(nullable = false)
    public Boolean receiveBiz = false;
    @Column(nullable = false)
    public Boolean visitBiz = false;
    @Column(nullable = false)
    public Boolean recoverBiz = false;

    public boolean anyBiz() { return Boolean.TRUE.equals(receiveBiz) || Boolean.TRUE.equals(visitBiz) || Boolean.TRUE.equals(recoverBiz); }
    public LocalDateTime updatedAt;
    public Long updatedBy;
}
