package com.bingoasm.service;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.auth.PermissionService;
import com.bingoasm.auth.Roles;
import com.bingoasm.auth.Scope;
import com.bingoasm.common.*;
import com.bingoasm.domain.*;
import com.bingoasm.repo.*;
import com.bingoasm.repo.as.RegionRepository;
import com.bingoasm.repo.as.SchoolRepository;
import com.bingoasm.repo.as.VendorRepository;
import java.util.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class UserService {
    private final UserRepository users;
    private final DepartmentRepository depts;
    private final OrgRepository orgs;
    private final AssetRepository assets;
    private final BCryptPasswordEncoder encoder;
    private final SchoolRepository schools;
    private final RegionRepository regions;
    private final VendorRepository vendors;
    private final PermissionService permissions;
    private final com.bingoasm.repo.as.SchoolVendorRepository schoolVendors;
    private final com.bingoasm.repo.as.AsRequestRepository requests;

    public UserService(UserRepository users, DepartmentRepository depts, OrgRepository orgs, AssetRepository assets, BCryptPasswordEncoder encoder,
                       SchoolRepository schools, RegionRepository regions, VendorRepository vendors, PermissionService permissions,
                       com.bingoasm.repo.as.SchoolVendorRepository schoolVendors, com.bingoasm.repo.as.AsRequestRepository requests) {
        this.schoolVendors = schoolVendors; this.requests = requests;
        this.schools = schools; this.regions = regions; this.vendors = vendors; this.permissions = permissions;
        this.users = users; this.depts = depts; this.orgs = orgs; this.assets = assets; this.encoder = encoder;
    }

    public Json view(AppUser u, Map<Long, String> deptNames, String orgName) {
        return Json.obj().with("userId", u.userId).with("orgId", u.orgId).with("orgName", orgName)
                .with("deptId", u.deptId).with("deptName", u.deptId == null ? null : deptNames.get(u.deptId))
                .with("loginId", u.loginId).with("userName", u.userName).with("positionName", u.positionName)
                .with("email", u.email).with("mobile", u.mobile).with("status", u.status).with("loginFailCnt", u.loginFailCnt)
                .with("lastLoginAt", u.lastLoginAt).with("createdAt", u.createdAt).with("roles", u.roles)
                .with("schoolId", u.schoolId).with("vendorId", u.vendorId).with("regionId", u.regionId)
                .with("memberType", PermissionService.memberType(u)).with("affiliation", affiliation(u))
                .with("locked", "LOCKED".equals(u.status) || (u.lockedUntil != null && u.lockedUntil.isAfter(Times.now())))
                .with("permOverrides", u.grantedPerms.size() + u.deniedPerms.size());
    }

    /** 소속 이름 (학교·업체·교육지원청). */
    private String affiliation(AppUser u) {
        if (u.schoolId != null) return schools.findById(u.schoolId).map(s -> s.schoolName).orElse(null);
        if (u.vendorId != null) return vendors.findById(u.vendorId).map(v -> v.vendorName).orElse(null);
        if (u.regionId != null) return regions.findById(u.regionId).map(r -> r.regionName).orElse(null);
        return null;
    }

    /** 사용자 관리는 `admin`과 도교육청만. 역할로 권한을 받은 예전 자산관리 계정도 막는다. */
    private static void requireUserAdmin(CurrentUser me) {
        if (!me.scope().province()) throw ApiException.forbidden("사용자 관리는 도교육청 관리자만 할 수 있습니다.");
    }

    private static final List<String> TOP_ROLES = List.of("SYS_ADMIN", "SUPER_ADMIN");

    /** 시스템·통합 관리자 계정은 통합 관리자만 고칠 수 있다. 막지 않으면 비밀번호를 바꿔 그 계정을 차지할 수 있다. */
    private static void guardTarget(CurrentUser me, AppUser target) {
        if (target.roles.stream().anyMatch(TOP_ROLES::contains) && !me.hasRole("SUPER_ADMIN"))
            throw ApiException.forbidden("시스템 관리자 계정은 통합 관리자만 고칠 수 있습니다.");
    }

    private Map<Long, String> deptNames(Long orgId) {
        Map<Long, String> m = new HashMap<>();
        for (Department d : depts.findByOrgId(orgId)) m.put(d.deptId, d.deptName);
        return m;
    }

    private String orgName(Long orgId) {
        return orgs.findById(orgId).map(o -> o.orgName).orElse(null);
    }

    private static boolean contains(String v, String kw) {
        return v != null && v.toLowerCase().contains(kw.toLowerCase());
    }

    @Transactional(readOnly = true)
    public PageResult<Json> list(CurrentUser me, String keyword, Long deptId, String role, String status, Integer page, Integer size) {
        requireUserAdmin(me);
        Map<Long, String> dn = deptNames(me.orgId());
        String on = orgName(me.orgId());
        List<Json> rows = users.findByOrgIdOrderByUserIdAsc(me.orgId()).stream()
                .filter(u -> Params.blank(keyword) || contains(u.loginId, keyword) || contains(u.userName, keyword) || contains(u.email, keyword) || contains(u.mobile, keyword))
                .filter(u -> deptId == null || deptId.equals(u.deptId))
                .filter(u -> Params.blank(role) || u.roles.contains(role))
                .filter(u -> Params.blank(status) || status.equals(u.status))
                .map(u -> view(u, dn, on)).toList();
        return PageResult.of(rows, page, size);
    }

    @Transactional(readOnly = true)
    public List<Json> processors(CurrentUser me) {
        Map<Long, String> dn = deptNames(me.orgId());
        return users.findByOrgIdOrderByUserIdAsc(me.orgId()).stream()
                .filter(u -> "ACTIVE".equals(u.status) && u.roles.contains("PROCESSOR"))
                .map(u -> Json.obj().with("userId", u.userId).with("deptName", u.deptId == null ? null : dn.get(u.deptId))
                        .with("userName", u.userName).with("positionName", u.positionName))
                .toList();
    }

    private void applyProfile(AppUser u, Map<String, Object> b) {
        if (b.containsKey("deptId")) u.deptId = Params.lng(b, "deptId");
        if (b.containsKey("userName")) u.userName = Params.str(b, "userName");
        if (b.containsKey("positionName")) u.positionName = Params.str(b, "positionName");
        if (b.containsKey("email")) u.email = Params.str(b, "email");
        if (b.containsKey("mobile")) u.mobile = Params.str(b, "mobile");
        // 원클릭 AS 소속: 학교 담당자 → schoolId, 업체 기사·관리자 → vendorId, 교육지원청 담당자 → regionId
        if (b.containsKey("schoolId")) u.schoolId = Params.lng(b, "schoolId");
        if (b.containsKey("vendorId")) u.vendorId = Params.lng(b, "vendorId");
        if (b.containsKey("regionId")) u.regionId = Params.lng(b, "regionId");
        if (b.containsKey("status")) {
            String s = Params.str(b, "status");
            if (s != null && !Codes.USER_STATUS.contains(s)) throw ApiException.badRequest("사용자 상태가 올바르지 않습니다.");
            if (s != null) u.status = s;
        }
    }

    /**
     * 역할과 소속의 일관성 (역할→소속 표는 Roles.AFFILIATION):
     * 학교 담당자는 학교, AS 기사·업체 관리자는 업체, 교육지원청 담당자는 교육지원청이 꼭 있어야 하고,
     * 한 계정에 학교·업체·교육지원청 역할을 섞거나 기존 자산관리 역할(요청·접수·처리자)을 함께 줄 수 없다.
     * 학교 계정의 지역은 학교에서 따오므로 계정에 따로 두지 않는다.
     */
    private void checkAffiliation(AppUser u) {
        Set<String> kinds = new LinkedHashSet<>();
        for (String r : u.roles) if (Roles.AFFILIATION.containsKey(r)) kinds.add(Roles.AFFILIATION.get(r));
        if (kinds.size() > 1) throw ApiException.badRequest("한 계정에 학교·업체·교육지원청 역할을 함께 줄 수 없습니다.");
        if (!kinds.isEmpty() && u.roles.stream().anyMatch(Roles.LEGACY::contains))
            throw ApiException.badRequest("원클릭 AS 역할과 기존 자산관리 역할(요청·접수·처리자)은 함께 줄 수 없습니다.");
        if (kinds.contains("school") && u.schoolId == null) throw ApiException.badRequest("학교 담당자는 소속 학교를 지정해야 합니다.");
        if (kinds.contains("vendor") && u.vendorId == null) throw ApiException.badRequest("AS 기사·업체 관리자는 소속 업체를 지정해야 합니다.");
        if (u.schoolId != null && u.vendorId != null) throw ApiException.badRequest("학교와 업체에 함께 소속될 수 없습니다.");
        if (u.schoolId != null && schools.findById(u.schoolId).filter(s -> s.orgId.equals(u.orgId)).isEmpty())
            throw ApiException.badRequest("소속 학교가 올바르지 않습니다.");
        if (u.vendorId != null && vendors.findById(u.vendorId).filter(v -> v.orgId.equals(u.orgId)).isEmpty())
            throw ApiException.badRequest("소속 업체가 올바르지 않습니다.");
        if (u.vendorId != null && "ACTIVE".equals(u.status) && vendors.findById(u.vendorId).filter(v -> "Y".equals(v.useYn)).isEmpty())
            throw ApiException.badRequest("삭제된 업체의 계정은 사용할 수 없습니다. 소속 업체를 바꿔 주세요.");
        if (u.regionId != null && regions.findById(u.regionId).filter(r -> r.orgId.equals(u.orgId) && r.active()).isEmpty())
            throw ApiException.badRequest("소속 교육지원청이 올바르지 않습니다.");
        if (kinds.contains("region")) {
            if (u.schoolId != null || u.vendorId != null) throw ApiException.badRequest("교육지원청 담당자는 학교나 업체에 소속될 수 없습니다.");
            if (u.regionId == null) throw ApiException.badRequest("교육지원청 담당자는 소속 교육지원청을 지정해야 합니다.");
        }
        if (u.schoolId != null || u.vendorId != null) u.regionId = null;
    }

    /** body.roles를 알려진 역할만 정해진 순서로. 시스템·통합 관리자 권한은 통합 관리자만 줄 수 있다. roles가 없으면 null. */
    private static List<String> requestedRoles(CurrentUser me, AppUser target, Map<String, Object> b) {
        if (!(b.get("roles") instanceof List<?> l)) return null;
        List<String> requested = l.stream().map(String::valueOf).toList();
        List<String> roles = Roles.ORDER.stream().filter(requested::contains).toList();
        for (String top : TOP_ROLES)
            if (roles.contains(top) && (target == null || !target.roles.contains(top)) && !me.hasRole("SUPER_ADMIN"))
                throw ApiException.forbidden("시스템·통합 관리자 권한은 통합 관리자만 부여할 수 있습니다.");
        return roles;
    }

    private void setPassword(AppUser u, String pw) {
        PasswordPolicy.check(pw, u.loginId, u.mobile);
        u.passwordChangedAt = Times.now();
        u.password = encoder.encode(pw);
    }

    public Json create(CurrentUser me, Map<String, Object> b) {
        requireUserAdmin(me);
        String loginId = Params.str(b, "loginId");
        String pw = Params.rawStr(b, "password");
        if (loginId == null || Params.str(b, "userName") == null || Params.blank(pw)) throw ApiException.badRequest("아이디, 이름, 비밀번호는 필수입니다.");
        if (users.findByLoginId(loginId).isPresent()) throw ApiException.conflict("이미 사용 중인 아이디입니다.");
        AppUser u = new AppUser();
        u.orgId = me.orgId(); u.loginId = loginId; u.createdAt = Times.now();
        // 역할을 함께 보내면 그 역할로 만든다 (원클릭 AS 계정). 없으면 기존 자산관리 기본값인 요청자.
        List<String> requested = requestedRoles(me, null, b);
        if (requested != null && !me.can("ROLE_GRANT")) throw ApiException.forbidden("역할을 줄 권한이 없습니다.");
        u.roles = new ArrayList<>(requested == null || requested.isEmpty() ? List.of("REQUESTER") : requested);
        applyProfile(u, b);
        checkAffiliation(u);
        u.status = "ACTIVE";
        setPassword(u, pw);
        users.save(u);
        return view(u, deptNames(me.orgId()), orgName(me.orgId()));
    }

    private AppUser load(CurrentUser me, Long id) {
        return users.findById(id).filter(u -> u.orgId.equals(me.orgId())).orElseThrow(() -> ApiException.notFound("사용자를 찾을 수 없습니다."));
    }

    /** body.roles를 함께 보내면 역할과 소속을 한 번에 바꾼다 (학교 담당자 → 기사처럼 둘이 같이 바뀌어야 맞는 경우). */
    public Json update(CurrentUser me, Long id, Map<String, Object> b) {
        requireUserAdmin(me);
        AppUser u = load(me, id);
        guardTarget(me, u);
        if (u.userId.equals(me.userId()) && b.containsKey("status") && !"ACTIVE".equals(Params.str(b, "status")))
            throw ApiException.badRequest("본인 계정은 사용 중지할 수 없습니다.");
        List<String> roles = requestedRoles(me, u, b);
        if (roles != null) {
            if (!me.can("ROLE_GRANT")) throw ApiException.forbidden("역할을 줄 권한이 없습니다.");
            if (u.userId.equals(me.userId()) && !new HashSet<>(roles).equals(new HashSet<>(u.roles))) throw ApiException.badRequest("본인의 역할은 바꿀 수 없습니다.");
            u.roles.clear();
            u.roles.addAll(roles.isEmpty() ? List.of("REQUESTER") : roles);
        }
        applyProfile(u, b);
        if (Params.blank(u.userName)) throw ApiException.badRequest("이름을 입력해 주세요.");
        checkAffiliation(u);
        String pw = Params.rawStr(b, "password");
        if (!Params.blank(pw)) setPassword(u, pw);
        if ("ACTIVE".equals(Params.str(b, "status"))) { u.loginFailCnt = 0; u.lockedUntil = null; }
        return view(u, deptNames(me.orgId()), orgName(me.orgId()));
    }

    private static final List<String> OPEN_STATUS = List.of("A", "R");

    /** 삭제 = 사용 중지. AS·이력이 계정을 가리키므로 지우지 않는다. 처리 중인 AS가 있으면 거절하고, 학교의 기본 담당 기사에서는 뺀다. */
    public void delete(CurrentUser me, Long id) {
        requireUserAdmin(me);
        AppUser u = load(me, id);
        if (u.userId.equals(me.userId())) throw ApiException.badRequest("본인 계정은 삭제할 수 없습니다.");
        guardTarget(me, u);
        long open = requests.countByEngineerUserIdAndUseYnAndStatusIn(id, "Y", OPEN_STATUS);
        if (open > 0) throw ApiException.conflict("담당 중인 AS가 " + open + "건 있어 삭제할 수 없습니다. 처리를 끝내거나 다른 기사에게 넘겨 주세요.");
        for (var sv : schoolVendors.findByEngineerUserId(id)) sv.engineerUserId = null;
        u.status = "DISABLED";
    }

    public Json unlock(CurrentUser me, Long id) {
        requireUserAdmin(me);
        AppUser u = load(me, id);
        guardTarget(me, u);
        if ("LOCKED".equals(u.status)) u.status = "ACTIVE";
        u.loginFailCnt = 0;
        u.lockedUntil = null;
        return view(u, deptNames(me.orgId()), orgName(me.orgId()));
    }

    public Json roles(CurrentUser me, Long id, Map<String, Object> b) {
        requireUserAdmin(me);
        AppUser u = load(me, id);
        guardTarget(me, u);
        List<String> roles = requestedRoles(me, u, b);
        if (roles == null) roles = List.of();
        if (u.userId.equals(me.userId()) && me.hasRole("SYS_ADMIN") && !roles.contains("SYS_ADMIN"))
            throw ApiException.badRequest("본인의 시스템 관리자 권한은 해제할 수 없습니다.");
        u.roles.clear();
        u.roles.addAll(roles.isEmpty() ? List.of("REQUESTER") : roles);
        checkAffiliation(u);
        return view(u, deptNames(me.orgId()), orgName(me.orgId()));
    }

    /** 사용자별 메뉴·처리 기능 권한: 역할 기본값(base)과 조정(granted·denied), 그 결과(effective). 모두 Roles.ADJUSTABLE_PERMS 범위. */
    @Transactional(readOnly = true)
    public Json menuPerms(CurrentUser me, Long id) {
        requireUserAdmin(me);
        return menuPermsView(load(me, id));
    }

    private Json menuPermsView(AppUser u) {
        Set<String> base = permissions.basePerms(u), effective = permissions.effectivePerms(u);
        return Json.obj().with("userId", u.userId).with("loginId", u.loginId).with("userName", u.userName).with("roles", u.roles)
                .with("menuPerms", Roles.MENU_PERMS).with("actionPerms", Roles.ACTION_PERMS)
                .with("base", Roles.ADJUSTABLE_PERMS.stream().filter(base::contains).toList())
                .with("granted", new ArrayList<>(u.grantedPerms)).with("denied", new ArrayList<>(u.deniedPerms))
                .with("effective", Roles.ADJUSTABLE_PERMS.stream().filter(effective::contains).toList())
                .with("disabled", new ArrayList<>(permissions.disabledPerms(u.orgId)))
                .with("limits", menuLimits(Scope.of(u)));
    }

    /**
     * 메뉴를 켜도 이 사용자의 소속 범위 때문에 일부만 되는 것 (사용자 메뉴 권한 화면의 안내).
     * 실제 제한은 SchoolService(학교·업체 관리)와 scopeSchoolIds(학교 단위 데이터)가 한다.
     */
    static Map<String, String> menuLimits(Scope sc) {
        Map<String, String> m = new LinkedHashMap<>();
        switch (sc.kind()) {
            case SCHOOL -> {
                m.put("SCHOOL_MANAGE", "자기 학교 기본정보만 수정 (계약·담당업체·등록·삭제 불가)");
                m.put("VENDOR_MANAGE", "조회만 가능");
            }
            case VENDOR -> {
                for (String p : List.of("AS_MANAGE", "AS_STATS")) m.put(p, "자기 업체에 배정된 AS만");
                for (String p : List.of("WDEVICE_MANAGE", "SPACE_MANAGE", "ASSET_READ", "FLOOR_READ", "INVENTORY")) m.put(p, "담당으로 배정된 학교만");
                m.put("SCHOOL_MANAGE", "배정된 학교 조회만 가능");
                m.put("VENDOR_MANAGE", "조회만 가능");
            }
            case REGION -> m.put("VENDOR_MANAGE", "조회만 가능");
            default -> { }
        }
        return m;
    }

    /** body: { granted: [...], denied: [...] }. 역할 기본값과 같은 조정(이미 있는 권한 열기·없는 권한 숨기기)은 버린다. */
    public Json setMenuPerms(CurrentUser me, Long id, Map<String, Object> b) {
        requireUserAdmin(me);
        AppUser u = load(me, id);
        guardTarget(me, u);
        List<String> granted = permList(b.get("granted")), denied = permList(b.get("denied"));
        if (granted.stream().anyMatch(denied::contains)) throw ApiException.badRequest("같은 메뉴를 열고 숨길 수 없습니다.");
        Set<String> base = permissions.basePerms(u);
        u.grantedPerms.clear();
        granted.stream().filter(p -> !base.contains(p)).forEach(u.grantedPerms::add);
        u.deniedPerms.clear();
        denied.stream().filter(base::contains).forEach(u.deniedPerms::add);
        return menuPermsView(u);
    }

    private static List<String> permList(Object v) {
        if (v == null) return List.of();
        if (!(v instanceof List<?> l)) throw ApiException.badRequest("메뉴 권한 목록이 올바르지 않습니다.");
        List<String> perms = l.stream().map(String::valueOf).distinct().toList();
        for (String p : perms) if (!Roles.ADJUSTABLE_PERMS.contains(p)) throw ApiException.badRequest("조정할 수 없는 권한입니다: " + p);
        return perms;
    }

    @Transactional(readOnly = true)
    public List<Json> orgs(CurrentUser me) {
        boolean all = me.hasRole("SUPER_ADMIN");
        return orgs.findAll().stream().filter(o -> all || o.orgId.equals(me.orgId()))
                .map(o -> Json.obj().with("orgId", o.orgId).with("orgCode", o.orgCode).with("orgName", o.orgName).with("bizNo", o.bizNo)
                        .with("repName", o.repName).with("tel", o.tel).with("zipCode", o.zipCode).with("address", o.address)
                        .with("addressDetail", o.addressDetail).with("useYn", o.useYn).with("createdAt", o.createdAt)
                        .with("userCount", users.countByOrgId(o.orgId)).with("assetCount", assets.countByOrgIdAndUseYn(o.orgId, "Y")))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<Department> departments(CurrentUser me) {
        return depts.findByOrgIdAndUseYnOrderBySortOrderAsc(me.orgId(), "Y");
    }
}
