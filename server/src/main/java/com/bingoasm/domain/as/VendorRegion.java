package com.bingoasm.domain.as;

import jakarta.persistence.*;

/** 업체의 담당 지역. tel·note·sortOrder는 예전 버전의 값으로, VendorRegionMigration이 되돌릴 때만 읽는다. */
@Entity
@Table(name = "vendor_regions", uniqueConstraints = @UniqueConstraint(columnNames = {"vendorId", "regionId"}))
public class VendorRegion {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    public Long orgId;
    public Long vendorId;
    public Long regionId;
    @Column(length = 100)
    public String tel;
    @Column(length = 200)
    public String note;
    public Integer sortOrder;
}
