package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

/**
 * 유지보수 계약: 업체에 주는 정액 계약금. AS 비용 통계는 계약 기간의 일수로 금액을 나눠 연·월에 배분하고,
 * 지역·AS 구분으로 볼 때는 계약이 맡은 지역 수·구분 수로 똑같이 나눈다 (AsCostService.share).
 */
@Entity
@Table(name = "as_contracts", indexes = @Index(columnList = "orgId"))
public class AsContract {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long contractId;
    public Long orgId;
    public Long vendorId;
    @Column(length = 200, nullable = false)
    public String contractName;
    public LocalDate startDate;
    public LocalDate endDate;
    /** 계약 금액(원, 부가세 포함 총액). */
    public Long amount;
    /** 계약이 맡는 AS 구분 csv (C,M,S,T). */
    @Column(length = 20)
    public String serviceTypes;
    /** true = 전체 지역. false면 regionIds의 지역만. */
    public Boolean allRegions;
    @Column(length = 500)
    public String regionIds;
    @Column(length = 1000)
    public String note;
    @Column(length = 1)
    public String useYn = "Y";
    public LocalDateTime createdAt;
    public LocalDateTime updatedAt;

    public List<String> serviceTypeList() {
        return serviceTypes == null || serviceTypes.isBlank() ? List.of() : Arrays.stream(serviceTypes.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    public List<Long> regionIdList() {
        return regionIds == null || regionIds.isBlank() ? List.of() : Arrays.stream(regionIds.split(",")).map(String::trim).filter(s -> !s.isEmpty()).map(Long::valueOf).toList();
    }
}
