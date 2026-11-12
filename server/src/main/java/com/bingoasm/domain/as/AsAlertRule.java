package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** AS 지연 알림 기준 (V13): 교육청 · AS 유형마다 한 줄. 시간은 분. 없으면 AsAlertService의 기본값. */
@Entity
@Table(name = "as_alert_rules", uniqueConstraints = @UniqueConstraint(name = "uk_as_alert_rules", columnNames = {"orgId", "rceptTy"}))
public class AsAlertRule {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long ruleId;
    @Column(nullable = false)
    public Long orgId;
    @Column(length = 1, nullable = false)
    public String rceptTy;
    /** 신청 → 이 시간 안에 접수되지 않으면 업체에 접수 지연 알림 */
    @Column(nullable = false)
    public Integer receiveMin;
    /** 신청 → 이 시간까지도 접수되지 않으면 교육지원청 담당자에게 에스컬레이션 */
    @Column(nullable = false)
    public Integer escalateMin;
    /** 방문예정일시 + 이 시간이 지나도 처리 보고서가 없으면 방문 지연 알림 */
    @Column(nullable = false)
    public Integer visitGraceMin;
    @Column(nullable = false)
    public Boolean enabled = true;
    /** 근무 시간(근무 요일 · 시간대, 휴일 제외)으로 셀지 (V14). false면 24시간 달력 시간. */
    @Column(nullable = false)
    public Boolean businessHours = true;
    public LocalDateTime updatedAt;
    public Long updatedBy;
}
