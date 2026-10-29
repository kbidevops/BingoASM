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
}
