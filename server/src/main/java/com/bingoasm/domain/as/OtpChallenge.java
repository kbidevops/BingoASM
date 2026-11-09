package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** 2단계 인증 진행 중 상태 (비밀번호 확인 뒤 인증 앱 번호를 기다리는 동안). tries = 틀린 횟수. */
@Entity
@Table(name = "otp_challenges", indexes = @Index(columnList = "token"))
public class OtpChallenge {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(length = 64, unique = true, nullable = false)
    public String token;
    public Long userId;
    @Column(length = 100)
    public String codeHash;
    public Integer tries = 0;
    public Boolean used = false;
    public LocalDateTime createdAt;
    public LocalDateTime expiresAt;
    /** 인증 앱 등록 중이면 새 TOTP 비밀값 (첫 번호가 맞으면 사용자에게 옮긴다). Encrypted at rest. */
    @Convert(converter = com.bingoasm.common.CryptoConverter.class)
    public String setupSecret;
}
