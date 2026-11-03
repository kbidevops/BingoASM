package com.bingoasm.domain.as;

import jakarta.persistence.*;

/** 연간 AS 예산. regionId·rceptTy가 비어 있으면 전체 지역·전체 구분. 집행 = 계약 배분액 + 유상 지급완료액. */
@Entity
@Table(name = "as_budgets", uniqueConstraints = @UniqueConstraint(columnNames = {"orgId", "budgetYear", "regionId", "rceptTy"}))
public class AsBudget {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long budgetId;
    public Long orgId;
    public Integer budgetYear;
    public Long regionId;
    @Column(length = 1)
    public String rceptTy;
    public Long amount;
    @Column(length = 200)
    public String note;
}
