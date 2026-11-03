package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

/** 유지보수 업체. serviceTypes = 담당 접수유형 코드(C 정보기기, M 무선망, S 스쿨넷, T 스마트기기) 콤마 목록. */
@Entity
@Table(name = "vendors", indexes = @Index(columnList = "orgId"))
public class Vendor {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long vendorId;
    public Long orgId;
    /** 예전 담당 지역. VendorRegionMigration이 vendor_regions로 옮긴 뒤로는 쓰지 않는다. */
    public Long regionId;
    /** 전체 지역 담당. 아니면 담당 지역은 vendor_regions (null = 아직 옮기지 않은 업체) */
    public Boolean allRegions;
    /** 유지보수 사업자를 업체에서 만들던 버전의 표시. VendorRegionMigration이 되돌릴 때만 읽는다. */
    @Column(length = 1)
    public String publicYn = "N";
    @Column(length = 100, nullable = false)
    public String vendorName;
    public String bizNo;
    public String tel;
    public String address;
    @Column(length = 20)
    public String serviceTypes = "";
    @Column(length = 1)
    public String useYn = "Y";
    public LocalDateTime createdAt;
    public LocalDateTime updatedAt;

    public List<String> serviceTypeList() {
        return serviceTypes == null || serviceTypes.isBlank() ? List.of() : Arrays.stream(serviceTypes.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
