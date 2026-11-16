package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 스쿨넷 SLA 결과 (V21 · V23): 서비스 제공 업체(통신사)가 올리는 SLA 결과 파일. 매월이라는 보장이 없어 제목 · 대상 기간(선택)으로 몇 번이든 올린다.
 * 교육청(또는 그 업체가 맡은 지역의 교육지원청)이 승인하면 교육지원청 · 학교도 본다.
 */
@Entity
@Table(name = "sla_reports")
public class SlaReport {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long reportId;
    @Column(nullable = false)
    public Long orgId;
    @Column(nullable = false)
    public Long vendorId;
    @Column(nullable = false, length = 200)
    public String title;
    /** 결과가 다루는 기간 (선택) */
    public LocalDate periodFrom;
    public LocalDate periodTo;
    @Column(length = 1000)
    public String note;
    /** 첨부 파일 id (쉼표) */
    @Column(nullable = false, length = 500)
    public String fileIds;
    /** SUBMITTED 승인 대기 · APPROVED 승인 · REJECTED 반려 */
    @Column(nullable = false, length = 10)
    public String status;
    @Column(length = 1000)
    public String rejectReason;
    public Long submittedBy;
    @Column(nullable = false)
    public LocalDateTime submittedAt;
    public Long reviewedBy;
    public LocalDateTime reviewedAt;
}
