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
    /** 2단계 인증(OTP) 사용 여부 */
    public Boolean otpEnabled = false;
    /** 로그인 실패 누적으로 잠긴 경우 해제 시각 */
    public LocalDateTime lockedUntil;
    public LocalDateTime passwordChangedAt;
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

    public Set<String> roleSet() {
        return new LinkedHashSet<>(roles);
    }
}
