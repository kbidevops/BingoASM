package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** 장비 위치 변경 기록: 설치위치가 언제 · 누가 · 어디서 어디로 바뀌었는지 (V7). */
@Entity
@Table(name = "device_histories", indexes = @Index(name = "idx_device_histories_device", columnList = "deviceId, historyId"))
public class DeviceHistory {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long historyId;
    public Long deviceId;
    public Long orgId;
    /** EDIT 장비 수정에서 바꿈 / PLAN 도면에서 옮김 / FLOOR 다른 층으로 옮김 */
    @Column(length = 20)
    public String actionType;
    public String fromPlace;
    public String toPlace;
    public Long workerId;
    @Column(length = 50)
    public String workerName;
    public LocalDateTime createdAt;
}
