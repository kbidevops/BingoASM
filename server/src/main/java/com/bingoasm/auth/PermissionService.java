package com.bingoasm.auth;

import com.bingoasm.common.AppProperties;
import com.bingoasm.domain.AppUser;
import com.bingoasm.domain.Org;
import com.bingoasm.domain.as.AsCodes;
import com.bingoasm.domain.as.Vendor;
import com.bingoasm.repo.OrgRepository;
import com.bingoasm.repo.as.VendorRepository;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Effective permissions = role permissions + menus derived from the user's vendor, then the per-user menu overrides
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

    public PermissionService(VendorRepository vendors, OrgRepository orgs, AppProperties props) {
        this.vendors = vendors;
        this.orgs = orgs;
        this.props = props;
    }

    public Set<String> effectivePerms(AppUser u) {
        Set<String> perms = basePerms(u);
        for (String p : u.grantedPerms) if (Roles.ADJUSTABLE_PERMS.contains(p)) perms.add(p);
        for (String p : u.deniedPerms) if (Roles.ADJUSTABLE_PERMS.contains(p)) perms.remove(p);
        perms.removeAll(disabledPerms(u.orgId));
        return perms;
    }

    /** Permissions from roles and vendor only, before the per-user overrides. */
    public Set<String> basePerms(AppUser u) {
        Set<String> perms = new LinkedHashSet<>(Roles.permsOf(u.roles));
        if (u.vendorId != null && (u.roles.contains("AS_ENGINEER") || u.roles.contains("VENDOR_ADMIN"))) {
            Vendor v = vendors.findById(u.vendorId).orElse(null);
            if (v != null) for (String ty : v.serviceTypeList()) {
                if ("T".equals(ty)) { perms.add("SMART_REQUEST"); continue; }
                perms.add("AS_" + ty + "_REQUEST");
                perms.add("AS_" + ty + "_VIEW");
            }
        }
        perms.removeAll(disabledPerms(u.orgId));
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
