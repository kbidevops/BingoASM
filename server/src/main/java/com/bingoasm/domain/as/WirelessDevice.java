package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDate;

/** 무선장비관리·스쿨넷장비관리: 학교에 설치된 네트워크 장비. rceptTy로 나눈다 (M 무선망 / S 스쿨넷). */
@Entity
@Table(name = "wireless_devices", indexes = @Index(columnList = "schoolId"))
public class WirelessDevice {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long deviceId;
    public Long orgId;
    public Long schoolId;
    /** M 무선망 장비 / S 스쿨넷 장비 (AS 접수 유형과 같은 값) */
    @Column(length = 1)
    public String rceptTy = "M";
    /** 무선장비관리번호 */
    @Column(length = 30)
    public String deviceCode;
    @Column(length = 100, nullable = false)
    public String deviceName;
    /** 무선망: AP / SWITCH / CONTROLLER. 스쿨넷: ROUTER / L3 / L2 / FIREWALL / ETC (WirelessDeviceService.TYPES) */
    @Column(length = 12)
    public String deviceType = "AP";
    public String modelName;
    public String ipAddress;
    public String macAddress;
    /** 설치 위치 */
    public String location;
    /** 무선장비 위치(도면): 놓인 층과 그 층 도면 위 좌표 (도면 크기 대비 %, 0~100). 셋 다 있거나 셋 다 없다. */
    public Long floorId;
    public Double posX;
    public Double posY;
    public LocalDate installedAt;
    public LocalDate lastCheckedAt;
    /** 스쿨넷 회선: 통신사 · 회선번호 · 회선 속도 */
    @Column(length = 30)
    public String carrier;
    @Column(length = 50)
    public String circuitId;
    @Column(length = 30)
    public String bandwidth;
    /** NORMAL 정상 / CHECK 점검중 / FAULT 장애 / DISPOSED 폐기 */
    @Column(length = 10)
    public String status = "NORMAL";
    @Column(length = 500)
    public String note;
    @Column(length = 1)
    public String useYn = "Y";
    /** 유지보수 업체 (V15): 무선망 AS는 대상 장비의 업체가 맡는다. 스쿨넷은 회선 통신사(통신사에 넘길 때 추천). */
    public Long vendorId;
}
