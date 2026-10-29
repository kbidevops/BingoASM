package com.bingoasm.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "orgs")
public class Org {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long orgId;
    @Column(unique = true, nullable = false, length = 30)
    public String orgCode;
    @Column(nullable = false, length = 100)
    public String orgName;
    public String bizNo;
    public String repName;
    public String tel;
    public String zipCode;
    public String address;
    public String addressDetail;
    /** 자산번호 접두어 (예: CB → CB-2026-00012). 없으면 HW/SW. */
    @Column(length = 10)
    public String assetNoPrefix;
    @Column(length = 1)
    public String useYn = "Y";
    public LocalDateTime createdAt;
}
