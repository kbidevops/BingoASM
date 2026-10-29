package com.bingoasm.domain.as;

import jakarta.persistence.*;

/** 교육지원청 단위 지역 (도교육청 포함). */
@Entity
@Table(name = "as_regions")
public class Region {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long regionId;
    public Long orgId;
    @Column(length = 100, nullable = false)
    public String regionName;
    public Integer sortOrder;
}
