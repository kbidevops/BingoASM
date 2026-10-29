package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** QR 로그인 세션. 데스크톱이 token을 QR로 보여 주고, 로그인된 휴대폰이 승인한다. */
@Entity
@Table(name = "qr_login_sessions", indexes = @Index(columnList = "token"))
public class QrLoginSession {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(length = 64, unique = true, nullable = false)
    public String token;
    /** 휴대폰 화면에 표시해 사용자가 대조하는 2자리 숫자 */
    @Column(length = 2)
    public String num;
    /** PENDING / APPROVED / CONSUMED / REJECTED / EXPIRED */
    @Column(length = 10)
    public String status = "PENDING";
    public Long userId;
    @Column(length = 64)
    public String clientIp;
    public LocalDateTime createdAt;
    public LocalDateTime expiresAt;
    public LocalDateTime approvedAt;
}
