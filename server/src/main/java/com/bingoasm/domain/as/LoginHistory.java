package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "login_histories", indexes = @Index(columnList = "userId"))
public class LoginHistory {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    public Long userId;
    public LocalDateTime loginAt;
    @Column(length = 64)
    public String ip;
    /** PASSWORD / OTP / QR */
    @Column(length = 10)
    public String method;
    public Boolean success = true;
    @Column(length = 300)
    public String userAgent;
}
