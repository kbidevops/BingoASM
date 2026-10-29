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
    /** 담당 지역 (null = 전체) */
    public Long regionId;
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
