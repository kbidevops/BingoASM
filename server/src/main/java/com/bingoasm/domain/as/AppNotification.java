package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/**
 * 시스템 안 알림 (머리글의 종 모양). 받는 사람마다 한 줄. AS 처리 단계가 바뀔 때 AsRequestService가 만든다.
 * 외부로 나가지 않는다: 푸시·문자 없이 이 시스템 안에서만 보인다.
 */
@Entity
@Table(name = "notifications", indexes = {@Index(columnList = "userId, createdAt"), @Index(columnList = "userId, readAt")})
public class AppNotification {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long notificationId;
    public Long orgId;
    /** 받는 사람 */
    public Long userId;
    /** AS_NEW, AS_RECEIVED, AS_DONE, BILL_CONFIRMED … (AsRequestService) */
    @Column(length = 30, nullable = false)
    public String type;
    @Column(length = 200, nullable = false)
    public String title;
    @Column(length = 500)
    public String body;
    /** 누르면 열 대상: AS 신청 번호와 유형 */
    public Long asvcSn;
    @Column(length = 1)
    public String rceptTy;
    public LocalDateTime readAt;
    public LocalDateTime createdAt;
}
