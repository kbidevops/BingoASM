package com.bingoasm.web;

import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.CurrentUser;
import com.bingoasm.auth.PermissionService;
import com.bingoasm.auth.PermissionService.RoleAdjust;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.auth.Roles;
import com.bingoasm.auth.Scope;
import com.bingoasm.common.ApiException;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.common.Json;
import com.bingoasm.domain.AppUser;
import com.bingoasm.domain.RolePermOverride;
import com.bingoasm.repo.RolePermOverrideRepository;
import com.bingoasm.repo.UserRepository;
import com.bingoasm.service.UserService;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.bind.annotation.*;

/**
 * 역할 권한 관리: 교육청마다 역할(학교 · 기사 · 업체 관리자 · 교육청 · 교육지원청 · 관리자)의 메뉴와 AS 처리 기능을 켜고 끈다.
 * 역할 기본값은 Roles.ROLE_PERMS, 조정은 role_perm_overrides(V8). 사용자별 조정(사용자 메뉴 권한)은 이 위에 한 번 더 얹힌다.
 * 메뉴는 Roles.ADJUSTABLE_PERMS 안에서만 바뀌고, 데이터 범위(Scope: 자기 학교 · 업체 · 교육지원청)는 그대로다.
 * AS 처리 기능은 역할에 있는 것을 끌 수만 있다 (켜도 상태·소속 조건 때문에 쓸 수 없어서).
 */
@Tag(name = "역할 권한 관리", description = "교육청별 역할 메뉴·처리 기능 권한")
@RestController
public class RolePermController {
    private static final Map<String, String> ROLE_LABEL = Map.of(
            "SCHOOL_USER", "학교", "AS_ENGINEER", "기사", "VENDOR_ADMIN", "업체 관리자",
            "EDU_ADMIN", "교육청", "REGION_ADMIN", "교육지원청", "SYS_ADMIN", "관리자");

    private final PermissionService permissions;
    private final RolePermOverrideRepository overrides;
    private final UserRepository users;

    public RolePermController(PermissionService permissions, RolePermOverrideRepository overrides, UserRepository users) {
        this.permissions = permissions;
        this.overrides = overrides;
        this.users = users;
    }

    /** 시스템 관리자만 (AS 서비스 설정과 같다). 교육청 관리자는 자기 역할 권한을 넓힐 수 없다. */
    @GetMapping("/api/org/role-perms")
    @RequirePerm("ORG_WRITE")
    @Transactional(readOnly = true)
    public ApiResponse get() {
        Long orgId = AuthContext.get().orgId();
        return ApiResponse.ok(view(orgId, permissions.roleAdjusts(orgId)));
    }

    /** body: { roles: { SCHOOL_USER: { granted: [...], denied: [...] }, ... } }. 보낸 역할만 통째로 바꾼다. */
    @PutMapping("/api/org/role-perms")
    @RequirePerm("ORG_WRITE")
    @Transactional
    public ApiResponse set(@RequestBody Map<String, Object> body) {
        CurrentUser me = AuthContext.get();
        Long orgId = me.orgId();
        if (!(body.get("roles") instanceof Map<?, ?> raw) || raw.isEmpty()) throw ApiException.badRequest("roles 값이 필요합니다.");
        List<RolePermOverride> add = new ArrayList<>();
        Set<String> touched = new LinkedHashSet<>();
        LocalDateTime now = LocalDateTime.now();
        for (Map.Entry<?, ?> e : raw.entrySet()) {
            String role = String.valueOf(e.getKey());
            if (!Roles.MANAGED_ROLES.contains(role)) throw ApiException.badRequest("조정할 수 없는 역할입니다: " + role);
            if (!(e.getValue() instanceof Map<?, ?> v)) throw ApiException.badRequest(role + " 값이 올바르지 않습니다.");
            List<String> granted = perms(v.get("granted")), denied = perms(v.get("denied"));
            if (granted.stream().anyMatch(denied::contains)) throw ApiException.badRequest("같은 권한을 켜고 끌 수 없습니다.");
            List<String> def = Roles.ROLE_PERMS.get(role), typed = vendorTyped(role);
            for (String p : granted)
                if (Roles.blockedFor(role).contains(p)) throw ApiException.badRequest(ROLE_LABEL.get(role) + " 역할에는 '" + Roles.PERM_LABEL.getOrDefault(p, p) + "'을(를) 줄 수 없습니다.");
            touched.add(role);
            // 기본값과 같은 조정은 버린다. 처리 기능(만족도 평가 제외) · 편집 기능과 업체 유형 메뉴는 켤 수 없다 (끄기만).
            for (String p : granted)
                if (!def.contains(p) && !typed.contains(p) && (Roles.MENU_PERMS.contains(p) || Roles.GRANTABLE_ACTION_PERMS.contains(p)))
                    add.add(row(orgId, role, p, "G", me, now));
            for (String p : denied)
                if (def.contains(p) || typed.contains(p) || Roles.isFeature(p)) add.add(row(orgId, role, p, "D", me, now));
        }
        Map<String, RoleAdjust> result = new HashMap<>(permissions.roleAdjusts(orgId));
        touched.forEach(result::remove);
        result.putAll(regroup(add));
        overrides.deleteAllInBatch(overrides.findByOrgId(orgId).stream().filter(o -> touched.contains(o.roleCode)).toList());
        overrides.saveAll(add);
        permissions.evictRoleAdjusts(orgId);
        // 저장이 끝난 뒤 한 번 더 비운다 (그 사이 다른 요청이 예전 값을 읽어 둘 수 있어서).
        if (TransactionSynchronizationManager.isSynchronizationActive())
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { permissions.evictRoleAdjusts(orgId); }
            });
        return ApiResponse.ok(view(orgId, result));
    }

    private Json view(Long orgId, Map<String, RoleAdjust> adj) {
        List<AppUser> all = users.findByOrgIdOrderByUserIdAsc(orgId);
        List<Json> roles = Roles.MANAGED_ROLES.stream().map(r -> {
            RoleAdjust a = adj.getOrDefault(r, new RoleAdjust(Set.of(), Set.of()));
            return Json.obj().with("role", r).with("name", ROLE_LABEL.get(r))
                    .with("defaults", Roles.ROLE_PERMS.get(r))
                    .with("granted", new ArrayList<>(a.granted())).with("denied", new ArrayList<>(a.denied()))
                    .with("vendorTyped", vendorTyped(r)).with("blocked", Roles.blockedFor(r))
                    .with("limits", UserService.menuLimits(scopeOf(r)))
                    .with("userCount", all.stream().filter(u -> u.roles.contains(r)).count());
        }).toList();
        return Json.obj().with("roles", roles).with("menuPerms", Roles.MENU_PERMS).with("actionPerms", Roles.ACTION_PERMS).with("grantableActions", Roles.GRANTABLE_ACTION_PERMS).with("editPerms", Roles.EDIT_PERMS)
                .with("features", UserService.featureList())
                .with("disabled", new ArrayList<>(permissions.disabledPerms(orgId)));
    }

    private static Map<String, RoleAdjust> regroup(List<RolePermOverride> rows) {
        Map<String, RoleAdjust> m = new HashMap<>();
        for (RolePermOverride o : rows) {
            RoleAdjust a = m.computeIfAbsent(o.roleCode, r -> new RoleAdjust(new LinkedHashSet<>(), new LinkedHashSet<>()));
            ("G".equals(o.effect) ? a.granted() : a.denied()).add(o.permCode);
        }
        return m;
    }

    /** 업체 역할의 신청·조회 메뉴 중 역할 기본값에는 없고 업체 담당 유형으로 열리는 것. */
    private static List<String> vendorTyped(String role) {
        if (!Roles.vendorRole(role)) return List.of();
        List<String> def = Roles.ROLE_PERMS.get(role);
        return Roles.VENDOR_TYPED_PERMS.stream().filter(p -> !def.contains(p)).toList();
    }

    private static Scope scopeOf(String role) {
        return switch (role) {
            case "SCHOOL_USER" -> new Scope(Scope.Kind.SCHOOL, null, null, null);
            case "AS_ENGINEER", "VENDOR_ADMIN" -> new Scope(Scope.Kind.VENDOR, null, null, null);
            case "REGION_ADMIN" -> new Scope(Scope.Kind.REGION, null, null, null);
            default -> new Scope(Scope.Kind.PROVINCE, null, null, null);
        };
    }

    private static RolePermOverride row(Long orgId, String role, String perm, String effect, CurrentUser me, LocalDateTime now) {
        RolePermOverride o = new RolePermOverride();
        o.orgId = orgId;
        o.roleCode = role;
        o.permCode = perm;
        o.effect = effect;
        o.updatedAt = now;
        o.updatedBy = me.userId();
        return o;
    }

    private static List<String> perms(Object v) {
        if (v == null) return List.of();
        if (!(v instanceof List<?> l)) throw ApiException.badRequest("권한 목록이 올바르지 않습니다.");
        List<String> perms = l.stream().map(String::valueOf).distinct().toList();
        for (String p : perms) if (!Roles.ADJUSTABLE_PERMS.contains(p)) throw ApiException.badRequest("조정할 수 없는 권한입니다: " + p);
        return perms;
    }
}
