package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/**
 * 원클릭 AS 신청. rceptTy: C 정보기기, M 무선망, S 스쿨넷, T 스마트기기.
 * status: A 신청완료, R 접수완료, C 처리완료, X 반려.
 */
@Entity
@Table(name = "as_requests", indexes = {@Index(columnList = "orgId"), @Index(columnList = "schoolId"), @Index(columnList = "vendorId"), @Index(columnList = "requestAt")})
public class AsRequest {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long asvcSn;
    public Long orgId;
    @Column(length = 1, nullable = false)
    public String rceptTy;
    public Long schoolId;
    public Long applicantUserId;
    @Column(length = 50)
    public String applicantName;
    public String contactTel;
    @Column(length = 10)
    public String faultTypeCode;
    @Column(length = 100)
    public String faultTypeName;
    /** 무선망 요청내용: 1 원격 재부팅, 2 방문요청, 3 기타 */
    @Column(length = 2)
    public String requestTypeCode;
    @Column(length = 2000)
    public String symptom;
    public String installPlace;
    public Long deviceId;
    public String deviceName;
    public Long assetId;
    public String equipmentName;
    public String productName;
    public String modelName;
    public Integer quantity;
    public LocalDateTime visitRequestAt;
    @Column(length = 1, nullable = false)
    public String status = "A";
    public LocalDateTime requestAt;
    public Long vendorId;
    public Long engineerUserId;
    @Column(length = 50)
    public String engineerName;
    public LocalDateTime receivedAt;
    public LocalDateTime visitPlannedAt;
    public LocalDateTime completedAt;
    @Column(length = 1000)
    public String returnReason;
    @Column(length = 1)
    public String transferFromTy;
    @Column(length = 1000)
    public String transferContent;
    // ---- 처리 보고서 ----
    public LocalDateTime visitAt;
    public LocalDateTime visitEndAt;
    @Column(length = 2000)
    public String troubleSymptom;
    @Column(length = 2000)
    public String inspectContent;
    @Column(length = 2)
    public String processTypeCode;
    @Column(length = 2000)
    public String processContent;
    /** 처리비용 합계. 비용 항목(AsCostItem)이 있으면 그 합계. */
    public Long processAmount;
    /** FREE 무상(유지관리 계약·SLA 포함, 학교 청구 없음) / PAID 유상(별도 청구). 예전 보고서는 null. */
    @Column(length = 4)
    public String chargeType;
    /**
     * 유상 청구 진행: BILLED 청구(보고서 등록 시) → CONFIRMED 학교 확인 → PAID 지급 완료. 무상이면 null.
     * 예전 유상 보고서도 null이며 청구(BILLED)로 본다 (billStatus()).
     */
    @Column(length = 10)
    public String billStatus;
    public LocalDateTime billConfirmedAt;
    public Long billConfirmedBy;
    public LocalDateTime billPaidAt;
    public Long billPaidBy;
    /** 청구서·세금계산서 첨부 */
    @Column(length = 500)
    public String billFileIds;
    @Column(length = 500)
    public String reportFileIds;
    @Column(length = 500)
    public String attachFileIds;
    // ---- 만족도 ----
    public Integer evalScore;
    @Column(length = 1000)
    public String evalOpinion;
    public LocalDateTime evaluatedAt;
    @Column(length = 1)
    public String useYn = "Y";

    /** 처리 담당 종류 (V15): VENDOR 업체(기사) · REGION 교육지원청 · PROVINCE 교육청. null = VENDOR. 담당자는 engineerUserId. */
    @Column(length = 10)
    public String handlerType;

    // ---- 지연 알림 (V13, AsAlertService) ----
    /** 보낸 접수 지연 단계: 0 없음 · 1 업체에 접수 지연 · 2 교육지원청에 에스컬레이션 */
    @Column(nullable = false)
    public Integer receiveAlertLevel = 0;
    /** 방문 지연을 알린 방문예정일시 (일정을 바꾸면 다시 알린다) */
    public LocalDateTime visitAlertFor;

    /** 유상 건의 청구 단계. 무상·보고서 없음은 null. */
    public String billStatus() {
        return "PAID".equals(chargeType) ? (billStatus == null ? "BILLED" : billStatus) : null;
    }
}
