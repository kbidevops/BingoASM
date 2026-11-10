package com.bingoasm.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** 역할 권한 관리: 한 교육청에서 한 역할의 메뉴·처리 기능 권한을 기본값과 다르게 켜거나 끈 것 (V8). */
@Entity
@Table(name = "role_perm_overrides", uniqueConstraints = @UniqueConstraint(name = "uk_role_perm_overrides", columnNames = {"orgId", "roleCode", "permCode"}))
public class RolePermOverride {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long overrideId;
    @Column(nullable = false)
    public Long orgId;
    @Column(nullable = false, length = 30)
    public String roleCode;
    @Column(nullable = false, length = 40)
    public String permCode;
    /** G = 켬 (역할 기본값에 없는 권한), D = 끔 (역할 기본값에 있는 권한) */
    @Column(nullable = false, length = 1)
    public String effect;
    public LocalDateTime updatedAt;
    public Long updatedBy;
}
