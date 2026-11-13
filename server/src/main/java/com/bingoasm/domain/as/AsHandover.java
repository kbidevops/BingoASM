package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** 담당 구간 (V20): 신고가 담당(통신사 · 교육지원청 · 교육청)을 옮길 때마다 한 줄. 담당마다 자기 접수 시간으로 SLA를 판정한다. */
@Entity
@Table(name = "as_handovers")
public class AsHandover {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long handoverId;
    @Column(nullable = false)
    public Long orgId;
    @Column(nullable = false)
    public Long asvcSn;
    /** VENDOR · REGION · PROVINCE */
    @Column(nullable = false, length = 10)
    public String handlerType;
    public Long vendorId;
    public Long userId;
    /** 넘겨받은 시각 (첫 구간은 신청 시각) */
    @Column(nullable = false)
    public LocalDateTime startAt;
    /** 이 담당이 접수한 시각 */
    public LocalDateTime receivedAt;
    /** 다음 담당에게 넘긴 시각 (null = 지금 담당) */
    public LocalDateTime endAt;

    /** 통신사(업체)가 맡았던 구간인가 */
    public boolean vendorSegment() { return "VENDOR".equals(handlerType) && vendorId != null; }
}
