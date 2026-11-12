package com.bingoasm.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.Set;

@Entity
@Table(name = "users")
public class AppUser {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long userId;
    public Long orgId;
    public Long deptId;
    @Column(unique = true, nullable = false, length = 50)
    public String loginId;
    @Column(nullable = false)
    public String password;
    @Column(nullable = false, length = 50)
    public String userName;
    public String positionName;
    /** Encrypted at rest (AES-GCM), see CryptoConverter. */
    @Convert(converter = com.bingoasm.common.CryptoConverter.class)
    @Column(length = 400)
    public String email;
    @Convert(converter = com.bingoasm.common.CryptoConverter.class)
    @Column(length = 400)
    public String mobile;
    /** 원클릭 AS: 소속 학교 / 소속 업체 / 소속 교육지원청(REGION_ADMIN의 관할 범위) */
    public Long schoolId;
    public Long vendorId;
    public Long regionId;
    /** 교육지원청 담당자의 담당 AS 유형 (V12): 쉼표로 이은 접수유형 코드 (예 "M,S"). null = 모든 유형. */
    @Column(length = 40)
    public String asTypes;
    /** 2단계 인증(OTP) 사용 여부 */
    public Boolean otpEnabled = false;
    /** 인증 앱(Google OTP 등)의 TOTP 비밀값 (Base32). 없으면 다음 로그인 때 등록한다. Encrypted at rest. */
    @Convert(converter = com.bingoasm.common.CryptoConverter.class)
    public String totpSecret;
    /** 마지막으로 받은 번호의 시간 칸: 같은 번호를 두 번 쓰지 못하게 한다. */
    public Long totpLastStep;
    /** 로그인 실패 누적으로 잠긴 경우 해제 시각 */
    public LocalDateTime lockedUntil;
    public LocalDateTime passwordChangedAt;
    /** 임시 비밀번호 (V9): 관리자가 정한 비밀번호. 로그인하면 바꾸게 하고, 본인이 바꾸면 false. */
    @Column(nullable = false)
    public Boolean mustChangePassword = false;
    /** ACTIVE / LOCKED / DISABLED */
    @Column(length = 20)
    public String status = "ACTIVE";
    public Integer loginFailCnt = 0;
    public LocalDateTime lastLoginAt;
    public LocalDateTime createdAt;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "user_roles", joinColumns = @JoinColumn(name = "user_id"))
    @Column(name = "role_code", length = 30)
    @OrderColumn(name = "sort_order")
    public java.util.List<String> roles = new java.util.ArrayList<>();

    /** 사용자별 메뉴 조정: 역할에 없지만 열어 줄 메뉴 권한 (Roles.ADJUSTABLE_PERMS 안에서만). */
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "user_perm_grants", joinColumns = @JoinColumn(name = "user_id"))
    @Column(name = "perm_code", length = 40)
    public Set<String> grantedPerms = new LinkedHashSet<>();

    /** 사용자별 메뉴 조정: 역할에 있지만 숨길 메뉴 권한. 메뉴와 그 기능(API) 모두 막힌다. */
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "user_perm_denies", joinColumns = @JoinColumn(name = "user_id"))
    @Column(name = "perm_code", length = 40)
    public Set<String> deniedPerms = new LinkedHashSet<>();

    /** 담당 AS 유형 목록. 비어 있으면 모든 유형. */
    public java.util.List<String> asTypeList() {
        if (asTypes == null || asTypes.isBlank()) return java.util.List.of();
        return java.util.Arrays.stream(asTypes.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    /** 이 유형을 맡는가 (담당 유형을 정하지 않았으면 모든 유형). */
    public boolean coversAsType(String ty) {
        java.util.List<String> l = asTypeList();
        return l.isEmpty() || l.contains(ty);
    }

    public Set<String> roleSet() {
        return new LinkedHashSet<>(roles);
    }
}
