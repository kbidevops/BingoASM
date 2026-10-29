package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** 2단계 인증 코드. codeHash = BCrypt(code). */
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
}
