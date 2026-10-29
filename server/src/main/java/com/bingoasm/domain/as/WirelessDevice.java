package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDate;

/** 무선장비관리: 학교에 설치된 무선 AP·스위치. */
@Entity
@Table(name = "wireless_devices", indexes = @Index(columnList = "schoolId"))
public class WirelessDevice {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long deviceId;
    public Long orgId;
    public Long schoolId;
    /** 무선장비관리번호 */
    @Column(length = 30)
    public String deviceCode;
    @Column(length = 100, nullable = false)
    public String deviceName;
    /** AP 무선 AP / SWITCH PoE 스위치 / CONTROLLER 무선 컨트롤러 */
    @Column(length = 12)
    public String deviceType = "AP";
    public String modelName;
    public String ipAddress;
    public String macAddress;
    /** 설치 위치 */
    public String location;
    public LocalDate installedAt;
    public LocalDate lastCheckedAt;
    /** NORMAL 정상 / CHECK 점검중 / FAULT 장애 / DISPOSED 폐기 */
    @Column(length = 10)
    public String status = "NORMAL";
    @Column(length = 500)
    public String note;
    @Column(length = 1)
    public String useYn = "Y";
}
