package com.bingoasm.domain.as;

import jakarta.persistence.*;

/** 공간(실). 도면 위 영역(rect)은 도면 크기 대비 비율(0~1). */
@Entity
@Table(name = "rooms", indexes = {@Index(columnList = "schoolId"), @Index(columnList = "floorId")})
public class Room {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long roomId;
    public Long orgId;
    public Long schoolId;
    public Long buildingId;
    public Long floorId;
    @Column(length = 20)
    public String roomNo;
    @Column(length = 100, nullable = false)
    public String roomName;
    /** CLASS 교실 / SPECIAL 특별실 / ADMIN 행정·지원 / ETC 기타 */
    @Column(length = 10)
    public String roomType = "ETC";
    public String ownerName;
    public Double rectX;
    public Double rectY;
    public Double rectW;
    public Double rectH;
    @Column(length = 1)
    public String useYn = "Y";
}
