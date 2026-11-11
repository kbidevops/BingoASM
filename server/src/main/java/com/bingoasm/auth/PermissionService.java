package com.bingoasm.auth;

import com.bingoasm.common.AppProperties;
import com.bingoasm.domain.AppUser;
import com.bingoasm.domain.Org;
import com.bingoasm.domain.as.AsCodes;
import com.bingoasm.domain.as.Vendor;
import com.bingoasm.domain.RolePermOverride;
import com.bingoasm.repo.OrgRepository;
import com.bingoasm.repo.RolePermOverrideRepository;
import com.bingoasm.repo.as.VendorRepository;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Effective permissions = role permissions (Roles.ROLE_PERMS adjusted per 교육청 by 역할 권한 관리) + menus derived from the user's vendor, then the per-user menu overrides
 * (AppUser.grantedPerms added, deniedPerms removed — both limited to Roles.ADJUSTABLE_PERMS).
 * An AS engineer whose vendor handles M (무선망) and S (스쿨넷) gets AS_M_REQUEST/VIEW and AS_S_REQUEST/VIEW,
 * which reproduces the per-vendor menu visibility of the reference portal.
 * Finally the menus of AS services the user's 교육청 does not use (Org.asTypes) are removed for everyone, overrides included.
 */
@Service
public class PermissionService {
    private final VendorRepository vendors;
    private final OrgRepository orgs;
    private final AppProperties props;
    private final RolePermOverrideRepository overrides;
    /** orgId → 역할 → 조정. 권한은 요청마다 계산하므로 저장할 때(evictRoleAdjusts) 비운다. */
    private final Map<Long, Map<String, RoleAdjust>> adjustCache = new ConcurrentHashMap<>();

    public PermissionService(VendorRepository vendors, OrgRepository orgs, AppProperties props, RolePermOverrideRepository overrides) {
        this.vendors = vendors;
        this.orgs = orgs;
        this.props = props;
        this.overrides = overrides;
    }

    /** 역할 권한 관리에서 한 역할에 켠 권한(granted)과 끈 권한(denied). */
    public record RoleAdjust(Set<String> granted, Set<String> denied) {
        static final RoleAdjust NONE = new RoleAdjust(Set.of(), Set.of());
    }

    public Map<String, RoleAdjust> roleAdjusts(Long orgId) {
        if (orgId == null) return Map.of();
        return adjustCache.computeIfAbsent(orgId, id -> {
            Map<String, RoleAdjust> m = new HashMap<>();
            for (RolePermOverride o : overrides.findByOrgId(id)) {
                RoleAdjust a = m.computeIfAbsent(o.roleCode, r -> new RoleAdjust(new LinkedHashSet<>(), new LinkedHashSet<>()));
                ("G".equals(o.effect) ? a.granted() : a.denied()).add(o.permCode);
            }
            return m;
        });
    }

    public void evictRoleAdjusts(Long orgId) {
        if (orgId != null) adjustCache.remove(orgId);
    }

    /** 이 교육청에서 역할이 갖는 권한: 기본값 + 켬 − 끔 (조정은 Roles.ADJUSTABLE_PERMS 안에서만). */
    private static Set<String> rolePerms(String role, Map<String, RoleAdjust> adj) {
        Set<String> p = new LinkedHashSet<>(Roles.ROLE_PERMS.getOrDefault(role, List.of()));
        RoleAdjust a = adj.getOrDefault(role, RoleAdjust.NONE);
        for (String g : a.granted()) if (Roles.ADJUSTABLE_PERMS.contains(g)) p.add(g);
        for (String d : a.denied()) if (Roles.ADJUSTABLE_PERMS.contains(d)) p.remove(d);
        return p;
    }

    public Set<String> effectivePerms(AppUser u) {
        Set<String> perms = rolePart(u);
        // 기능 권한은 켜 줄 수 없다 (메뉴를 따라 켜지고 끄기만 한다) — finish()에서 정한다.
        for (String p : u.grantedPerms) if (Roles.ADJUSTABLE_PERMS.contains(p) && !Roles.isFeature(p)) perms.add(p);
        for (String p : u.deniedPerms) if (Roles.ADJUSTABLE_PERMS.contains(p) && !Roles.isFeature(p)) perms.remove(p);
        return finish(u, perms, u.deniedPerms);
    }

    /**
     * 공통 마무리: 쓰지 않는 서비스 · 소속에 막힌 메뉴를 빼고, 남은 메뉴의 기능 권한(Roles.FEATURES)을 켠다.
     * 기능은 그 메뉴가 있으면 켜지고, 역할(역할 권한 관리) 또는 사용자(사용자 메뉴 권한)에서 끈 것만 빠진다.
     */
    private Set<String> finish(AppUser u, Set<String> perms, Set<String> userDenied) {
        perms.removeAll(disabledPerms(u.orgId));
        perms.removeAll(blockedPerms(u));
        // 기관자산관리(ASSET_READ)를 끄면 자산 등록 · 일괄 등록 · 삭제 · 실사도 함께 막는다 (화면 없이 API로만 쓰지 못하게).
        if (!perms.contains("ASSET_READ")) perms.removeAll(Set.of("ASSET_WRITE", "ASSET_BULK", "ASSET_DELETE", "INVENTORY"));
        Map<String, RoleAdjust> adj = roleAdjusts(u.orgId);
        for (Roles.Feature f : Roles.FEATURES)
            if (perms.contains(f.parent()) && !userDenied.contains(f.code())
                    && u.roles.stream().noneMatch(r -> adj.getOrDefault(r, RoleAdjust.NONE).denied().contains(f.code())))
                perms.add(f.code());
        return perms;
    }

    /** 이 계정의 소속(데이터 범위) 때문에 줄 수 없는 권한: 학교 · 교육지원청 계정의 AS통계관리 등 (Roles.BLOCKED_BY_AFFILIATION). */
    public static Set<String> blockedPerms(AppUser u) {
        return switch (Scope.of(u).kind()) {
            case SCHOOL -> new LinkedHashSet<>(Roles.BLOCKED_BY_AFFILIATION.getOrDefault("school", List.of()));
            case REGION -> new LinkedHashSet<>(Roles.BLOCKED_BY_AFFILIATION.getOrDefault("region", List.of()));
            default -> Set.of();
        };
    }

    /** Permissions from roles and vendor only, before the per-user overrides (기능 권한 포함). */
    public Set<String> basePerms(AppUser u) {
        return finish(u, rolePart(u), Set.of());
    }

    /** 역할(조정 포함) + 업체 담당 유형. 사용 안 하는 서비스 · 기능 권한은 아직. */
    private Set<String> rolePart(AppUser u) {
        Map<String, RoleAdjust> adj = roleAdjusts(u.orgId);
        Set<String> perms = new LinkedHashSet<>();
        for (String r : u.roles) perms.addAll(rolePerms(r, adj));
        List<String> vendorRoles = u.roles.stream().filter(Roles::vendorRole).toList();
        if (u.vendorId != null && !vendorRoles.isEmpty()) {
            Vendor v = vendors.findById(u.vendorId).orElse(null);
            List<String> typed = new java.util.ArrayList<>();
            if (v != null) for (String ty : v.serviceTypeList()) {
                if ("T".equals(ty)) { typed.add("SMART_REQUEST"); continue; }
                typed.add("AS_" + ty + "_REQUEST");
                typed.add("AS_" + ty + "_VIEW");
            }
            // 역할 권한 관리에서 업체 역할에 끈 신청·조회 메뉴는 업체 담당 유형이어도 열지 않는다.
            for (String p : typed)
                if (vendorRoles.stream().anyMatch(r -> !adj.getOrDefault(r, RoleAdjust.NONE).denied().contains(p))) perms.add(p);
        }
        return perms;
    }

    // ---------- AS services per 교육청 ----------

    /** AS 서비스(접수 유형) the organisation uses, in C·M·S·T order. */
    public List<String> asTypes(Long orgId) {
        Org org = orgId == null ? null : orgs.findById(orgId).orElse(null);
        return parseAsTypes(org == null || org.asTypes == null || org.asTypes.isBlank() ? props.defaultAsTypes() : org.asTypes);
    }

    /** Menu permissions of the services the organisation does not use. */
    public Set<String> disabledPerms(Long orgId) {
        List<String> on = asTypes(orgId);
        Set<String> off = new LinkedHashSet<>();
        for (String ty : AsCodes.RCEPT_TYPES) if (!on.contains(ty)) off.addAll(Roles.AS_TYPE_PERMS.get(ty));
        // A permission shared with a service still in use stays.
        for (String ty : on) off.removeAll(Roles.AS_TYPE_PERMS.get(ty));
        return off;
    }

    /** Organisation the signed-out site describes: app.site-org-code, else the first one. */
    public Org siteOrg() {
        String code = props.siteOrgCode();
        if (code != null && !code.isBlank()) return orgs.findByOrgCode(code.trim()).orElse(null);
        return orgs.findAll().stream().min((a, b) -> Long.compare(a.orgId, b.orgId)).orElse(null);
    }

    static List<String> parseAsTypes(String csv) {
        Set<String> picked = new LinkedHashSet<>(Arrays.stream(csv == null ? new String[0] : csv.split(",")).map(String::trim).toList());
        return AsCodes.RCEPT_TYPES.stream().filter(picked::contains).toList();
    }

    /** 회원타입 표시용. */
    public static String memberType(AppUser u) {
        if (u.roles.contains("SUPER_ADMIN")) return "통합 관리자";
        if (u.roles.contains("EDU_ADMIN") || u.roles.contains("SYS_ADMIN")) return "교육청 관리자";
        if (u.roles.contains("REGION_ADMIN")) return "교육지원청 담당자";
        if (u.roles.contains("VENDOR_ADMIN")) return "업체 관리자";
        if (u.roles.contains("AS_ENGINEER")) return "AS 기사";
        if (u.roles.contains("SCHOOL_USER")) return "학교 담당자";
        if (u.roles.contains("PROCESSOR")) return "서비스 처리자";
        if (u.roles.contains("RECEIVER")) return "서비스 접수자";
        return "서비스 요청자";
    }
}
