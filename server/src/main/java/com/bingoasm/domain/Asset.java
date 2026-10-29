package com.bingoasm.domain;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "assets", indexes = {@Index(columnList = "orgId"), @Index(columnList = "floorId")})
public class Asset {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long assetId;
    public Long orgId;
    @Column(length = 50)
    public String assetNo;
    /** HW / SW */
    @Column(length = 2, nullable = false)
    public String assetType;
    public Long categoryId;
    @Column(nullable = false, length = 200)
    public String assetName;
    public String manufacturer;
    public String modelName;
    public String serialNo;
    @Column(length = 500)
    public String spec;
    public LocalDate acquiredAt;
    public Long acquirePrice;
    public LocalDate warrantyEnd;
    /** INUSE / IDLE / REPAIR / DISPOSED */
    @Column(length = 20)
    public String status = "INUSE";
    public Long buildingId;
    public Long floorId;
    /** 원클릭 AS: 소속 학교, 설치 실(공간) */
    public Long schoolId;
    public Long roomId;
    /** 내용연수(년). 비우면 분류 기본값. */
    public Integer lifeYears;
    @Column(length = 300)
    public String locationDetail;
    /** Position on the floor plan, percent of width / height. */
    public Double posX;
    public Double posY;
    public Long ownerUserId;
    public Long deptId;
    /** For installed software: the hardware asset it is installed on. */
    public Long parentAssetId;
    @Column(length = 2000)
    public String note;
    @Column(length = 1)
    public String useYn = "Y";
    public LocalDateTime createdAt;
    public LocalDateTime updatedAt;

    @Embedded
    public HwDetail hw;
    @Embedded
    public SwDetail sw;
}
