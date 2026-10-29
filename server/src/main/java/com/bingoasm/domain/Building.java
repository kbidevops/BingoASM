package com.bingoasm.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "buildings")
public class Building {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long buildingId;
    public Long orgId;
    /** 학교 건물이면 학교 ID (기관 건물은 null) */
    public Long schoolId;
    @Column(nullable = false, length = 100)
    public String buildingName;
    public String zipCode;
    public String address;
    public String addressDetail;
    @Column(length = 1)
    public String useYn = "Y";
}
