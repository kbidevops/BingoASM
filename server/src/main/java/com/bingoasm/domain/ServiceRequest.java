package com.bingoasm.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "service_requests", indexes = {@Index(columnList = "orgId"), @Index(columnList = "assetId"), @Index(columnList = "requestAt")})
public class ServiceRequest {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long requestId;
    public Long orgId;
    @Column(length = 30)
    public String requestNo;
    public Long assetId;
    @Column(length = 30)
    public String requestType;
    @Column(length = 20)
    public String priority;
    @Column(nullable = false, length = 200)
    public String title;
    @Column(length = 4000)
    public String content;
    /** REQUESTED / RECEIVED / ASSIGNED / PROCESSING / HOLD / COMPLETED / CLOSED / REJECTED */
    @Column(length = 20)
    public String status;
    public Long requesterId;
    public LocalDateTime requestAt;
    public String contactTel;
    public Long buildingId;
    public Long floorId;
    @Column(length = 300)
    public String locationDetail;
    public Long receiverId;
    public LocalDateTime receivedAt;
    public Long processorId;
    public LocalDateTime assignedAt;
    public LocalDateTime dueAt;
    public LocalDateTime startedAt;
    public LocalDateTime completedAt;
    @Column(length = 30)
    public String causeCode;
    @Column(length = 30)
    public String actionCode;
    @Column(length = 4000)
    public String actionContent;
    public Integer workMinutes;
    public LocalDateTime closedAt;
    @Column(length = 1000)
    public String holdReason;
    @Column(length = 1000)
    public String rejectReason;
}
