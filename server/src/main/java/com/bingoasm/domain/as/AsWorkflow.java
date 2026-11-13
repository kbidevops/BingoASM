package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** AS 처리 흐름 (V16): 교육청 · AS 유형마다 한 줄. 값의 뜻은 WorkflowService. */
@Entity
@Table(name = "as_workflows", uniqueConstraints = @UniqueConstraint(name = "uk_as_workflows", columnNames = {"orgId", "rceptTy"}))
public class AsWorkflow {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long workflowId;
    @Column(nullable = false)
    public Long orgId;
    @Column(length = 1, nullable = false)
    public String rceptTy;
    @Column(length = 10, nullable = false)
    public String firstReceiver;
    @Column(length = 12, nullable = false)
    public String deviceLink;
    @Column(length = 10, nullable = false)
    public String vendorSource;
    @Column(length = 10, nullable = false)
    public String engineerAssign;
    @Column(nullable = false)
    public Boolean officeHandling;
    @Column(nullable = false)
    public Boolean arrivalRequired;
    @Column(nullable = false)
    public Boolean evaluation;
    public LocalDateTime updatedAt;
    public Long updatedBy;
}
