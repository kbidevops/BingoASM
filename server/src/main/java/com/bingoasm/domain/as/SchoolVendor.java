package com.bingoasm.domain.as;

import jakarta.persistence.*;

/** 기관별·접수유형별 담당 업체와 기본 담당 기사. */
@Entity
@Table(name = "school_vendors", uniqueConstraints = @UniqueConstraint(columnNames = {"schoolId", "rceptTy"}))
public class SchoolVendor {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    public Long schoolId;
    @Column(length = 1)
    public String rceptTy;
    public Long vendorId;
    public Long engineerUserId;
}
