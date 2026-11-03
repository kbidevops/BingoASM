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
    /** N = 지역 관리에서 삭제됨. 다른 화면에서는 사라지고, 문의처 안내에는 항목이 남아 있는 동안 나온다. */
    @Column(length = 1)
    public String useYn = "Y";

    public boolean active() { return !"N".equals(useYn); }
}
