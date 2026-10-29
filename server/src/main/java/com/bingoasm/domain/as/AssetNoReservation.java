package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** 미리 출력한 빈 라벨의 자산번호 예약. 스캔 시 이 번호로 등록 화면이 열린다. */
@Entity
@Table(name = "asset_no_reservations", indexes = @Index(columnList = "assetNo"))
public class AssetNoReservation {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    public Long orgId;
    public Long schoolId;
    @Column(length = 50, unique = true, nullable = false)
    public String assetNo;
    public Long reservedBy;
    public LocalDateTime reservedAt;
    public Long usedAssetId;
    public LocalDateTime usedAt;
}
