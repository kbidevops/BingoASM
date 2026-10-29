package com.bingoasm.web;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.*;
import com.bingoasm.common.*;
import com.bingoasm.domain.AppUser;
import com.bingoasm.domain.Org;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.DepartmentRepository;
import com.bingoasm.repo.OrgRepository;
import com.bingoasm.repo.UserRepository;
import com.bingoasm.repo.as.*;
import io.jsonwebtoken.Claims;
import jakarta.servlet.http.HttpServletRequest;
import java.security.SecureRandom;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/**
 * Login (password → optional OTP), QR login, token refresh, my page.
 * Security: BCrypt(12), per-IP rate limit, time-based lockout, OTP hashed and single-use, QR token single-use.
 */
@Tag(name = "인증", description = "로그인 · OTP · QR 로그인 · 토큰 갱신 · 내 정보 · 비밀번호 · 로그인 이력 · 즐겨찾기 메뉴")
@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private static final SecureRandom RND = new SecureRandom();
    private final UserRepository users;
    private final OrgRepository orgs;
    private final DepartmentRepository depts;
    private final SchoolRepository schools;
    private final VendorRepository vendors;
    private final RegionRepository regions;
    private final LoginHistoryRepository logins;
    private final OtpChallengeRepository otps;
    private final QrLoginSessionRepository qrs;
    private final MenuScrapRepository scraps;
    private final JwtService jwt;
    private final PermissionService permissions;
    private final BCryptPasswordEncoder encoder;
    private final RateLimiter limiter;
    private final AppProperties props;

    public AuthController(UserRepository users, OrgRepository orgs, DepartmentRepository depts, SchoolRepository schools,
                          VendorRepository vendors, LoginHistoryRepository logins, OtpChallengeRepository otps,
                          QrLoginSessionRepository qrs, MenuScrapRepository scraps, JwtService jwt, PermissionService permissions,
                          BCryptPasswordEncoder encoder, RateLimiter limiter, AppProperties props, RegionRepository regions) {
        this.users = users; this.orgs = orgs; this.depts = depts; this.schools = schools; this.vendors = vendors; this.logins = logins;
        this.otps = otps; this.qrs = qrs; this.scraps = scraps; this.jwt = jwt; this.permissions = permissions; this.encoder = encoder;
        this.limiter = limiter; this.props = props; this.regions = regions;
    }

    // ---------- views ----------

    public Json me(AppUser u) {
        Org org = orgs.findById(u.orgId).orElse(null);
        String dept = u.deptId == null ? null : depts.findById(u.deptId).map(d -> d.deptName).orElse(null);
        School sc = u.schoolId == null ? null : schools.findById(u.schoolId).orElse(null);
        String school = sc == null ? null : sc.schoolName;
        String vendor = u.vendorId == null ? null : vendors.findById(u.vendorId).map(v -> v.vendorName).orElse(null);
        // 학교 계정의 지역은 학교에서, 교육지원청 담당자는 계정에 지정된 지역.
        Long regionId = sc != null ? sc.regionId : u.regionId;
        String region = regionId == null ? null : regions.findById(regionId).map(r -> r.regionName).orElse(null);
        return Json.obj().with("userId", u.userId).with("loginId", u.loginId).with("userName", u.userName)
                .with("orgId", u.orgId).with("orgName", org == null ? null : org.orgName).with("deptName", dept)
                .with("positionName", u.positionName).with("email", u.email).with("mobile", u.mobile)
                .with("schoolId", u.schoolId).with("schoolName", school).with("vendorId", u.vendorId).with("vendorName", vendor)
                .with("regionId", regionId).with("regionName", region)
                .with("memberType", PermissionService.memberType(u)).with("otpEnabled", Boolean.TRUE.equals(u.otpEnabled))
                .with("passwordChangedAt", u.passwordChangedAt).with("createdAt", u.createdAt).with("lastLoginAt", u.lastLoginAt)
                .with("roles", u.roles).with("permissions", new ArrayList<>(permissions.effectivePerms(u)));
    }

    private static String clientIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        return xff != null && !xff.isBlank() ? xff.split(",")[0].trim() : req.getRemoteAddr();
    }

    /** 10.21.3.45 → 10.21.***.45 */
    /** 로그인 이력 표시용 IP 마스킹: IPv4는 가운데 옥텟, IPv6는 앞 두 그룹만 남긴다. */
    static String maskIp(String ip) {
        if (ip == null) return null;
        if (ip.contains(":")) {
            String[] g = ip.split(":");
            return (g.length > 1 ? g[0] + ":" + g[1] : g[0]) + ":****";
        }
        String[] p = ip.split("\\.");
        return p.length == 4 ? p[0] + "." + p[1] + ".***." + p[3] : ip;
    }

    private void record(AppUser u, HttpServletRequest req, String method, boolean ok) {
        LoginHistory h = new LoginHistory();
        h.userId = u.userId; h.loginAt = Times.now(); h.ip = clientIp(req); h.method = method; h.success = ok;
        String ua = req.getHeader("User-Agent");
        h.userAgent = ua == null ? null : ua.substring(0, Math.min(300, ua.length()));
        logins.save(h);
    }

    private Json tokens(AppUser u, HttpServletRequest req, String method) {
        u.loginFailCnt = 0;
        u.lockedUntil = null;
        u.lastLoginAt = Times.now();
        users.save(u);
        record(u, req, method, true);
        Json res = Json.obj();
        res.putAll(jwt.issue(u));
        res.put("me", me(u));
        return res;
    }

    // ---------- password login (+ OTP) ----------

    @PublicApi
    @PostMapping("/login")
    @Transactional(noRollbackFor = ApiException.class)
    public ApiResponse login(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        limiter.check("login:" + clientIp(req), 20);
        String loginId = Params.str(body, "loginId");
        String password = Params.rawStr(body, "password");
        String orgCode = Params.str(body, "orgCode");
        if (loginId == null || Params.blank(password)) throw ApiException.badRequest("아이디와 비밀번호를 입력해 주세요.");

        Org org = null;
        if (orgCode != null) org = orgs.findByOrgCode(orgCode).orElseThrow(() -> ApiException.unauthorized("기관 코드를 확인해 주세요."));
        AppUser u = (org == null ? users.findByLoginId(loginId) : users.findByLoginIdAndOrgId(loginId, org.orgId))
                .orElseThrow(() -> ApiException.unauthorized("아이디 또는 비밀번호가 올바르지 않습니다."));
        if ("LOCKED".equals(u.status)) throw new ApiException(HttpStatus.LOCKED, "계정이 잠겨 있습니다. 관리자에게 문의하세요.");
        if (!"ACTIVE".equals(u.status)) throw ApiException.forbidden("사용할 수 없는 계정입니다.");
        if (u.lockedUntil != null && u.lockedUntil.isAfter(Times.now())) {
            long min = java.time.Duration.between(Times.now(), u.lockedUntil).toMinutes() + 1;
            throw new ApiException(HttpStatus.LOCKED, "로그인 실패가 반복되어 " + min + "분 동안 잠겼습니다.");
        }
        if (!encoder.matches(password, u.password)) {
            u.loginFailCnt = (u.loginFailCnt == null ? 0 : u.loginFailCnt) + 1;
            int max = props.maxLoginFail();
            if (u.loginFailCnt >= max) {
                if (props.lockMinutes() > 0) u.lockedUntil = Times.now().plusMinutes(props.lockMinutes());
                else u.status = "LOCKED";
                u.loginFailCnt = 0;
            }
            users.save(u);
            record(u, req, "PASSWORD", false);
            if (u.lockedUntil != null) throw new ApiException(HttpStatus.LOCKED, "로그인 실패가 " + max + "회 반복되어 " + props.lockMinutes() + "분 동안 잠겼습니다.");
            if ("LOCKED".equals(u.status)) throw new ApiException(HttpStatus.LOCKED, "로그인 실패가 반복되어 계정이 잠겼습니다. 관리자에게 문의하세요.");
            throw ApiException.unauthorized("아이디 또는 비밀번호가 올바르지 않습니다. (" + u.loginFailCnt + "/" + max + ")");
        }
        if (Boolean.TRUE.equals(u.otpEnabled)) {
            return ApiResponse.ok(startOtp(u));
        }
        return ApiResponse.ok(tokens(u, req, "PASSWORD"));
    }

    /** Creates a 6-digit code valid for 5 minutes. The code would go out via messenger/SMS; in dev it is echoed back. */
    private Json startOtp(AppUser u) {
        String code = String.format("%06d", RND.nextInt(1_000_000));
        OtpChallenge c = new OtpChallenge();
        c.token = token(); c.userId = u.userId; c.codeHash = encoder.encode(code);
        c.createdAt = Times.now(); c.expiresAt = c.createdAt.plusMinutes(5);
        otps.save(c);
        Json res = Json.obj().with("step", "otp").with("otpToken", c.token).with("expiresAt", c.expiresAt)
                .with("message", "소통메신저로 보낸 6자리 인증번호를 입력하세요.");
        if (props.otpDevEcho()) res.put("devCode", code);
        return res;
    }

    @PublicApi
    @PostMapping("/otp/verify")
    @Transactional(noRollbackFor = ApiException.class)
    public ApiResponse verifyOtp(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        limiter.check("otp:" + clientIp(req), 20);
        OtpChallenge c = otps.findByToken(Optional.ofNullable(Params.str(body, "otpToken")).orElse("-"))
                .orElseThrow(() -> ApiException.unauthorized("인증 요청을 찾을 수 없습니다. 처음부터 다시 로그인해 주세요."));
        if (Boolean.TRUE.equals(c.used) || c.expiresAt.isBefore(Times.now())) throw ApiException.unauthorized("인증번호가 만료되었습니다. 다시 받아 주세요.");
        String code = Params.str(body, "code");
        if (code == null || !encoder.matches(code, c.codeHash)) {
            c.tries++;
            if (c.tries >= 5) c.used = true;
            otps.save(c);
            throw ApiException.unauthorized(c.used ? "인증번호를 5회 틀려 만료되었습니다." : "인증번호가 올바르지 않습니다. (" + c.tries + "/5)");
        }
        c.used = true;
        otps.save(c);
        AppUser u = users.findById(c.userId).orElseThrow(() -> ApiException.unauthorized("다시 로그인해 주세요."));
        return ApiResponse.ok(tokens(u, req, "OTP"));
    }

    @PublicApi
    @PostMapping("/otp/resend")
    @Transactional
    public ApiResponse resendOtp(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        limiter.check("otp:" + clientIp(req), 10);
        OtpChallenge c = otps.findByToken(Optional.ofNullable(Params.str(body, "otpToken")).orElse("-"))
                .orElseThrow(() -> ApiException.unauthorized("인증 요청을 찾을 수 없습니다."));
        if (c.createdAt.isBefore(Times.now().minusMinutes(30))) throw ApiException.unauthorized("처음부터 다시 로그인해 주세요.");
        c.used = true;
        otps.save(c);
        return ApiResponse.ok(startOtp(users.findById(c.userId).orElseThrow()));
    }

    // ---------- QR login ----------

    private static String token() {
        byte[] b = new byte[24];
        RND.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    /** Desktop: create a session; show {qrText} as a QR. Poll GET /qr/{token} until approved. */
    @PublicApi
    @PostMapping("/qr/start")
    @Transactional
    public ApiResponse qrStart(HttpServletRequest req) {
        limiter.check("qr:" + clientIp(req), 30);
        QrLoginSession q = new QrLoginSession();
        q.token = token(); q.num = String.format("%02d", RND.nextInt(90) + 10); q.clientIp = clientIp(req);
        q.createdAt = Times.now(); q.expiresAt = q.createdAt.plusSeconds(props.qrLoginSeconds());
        qrs.save(q);
        return ApiResponse.ok(Json.obj().with("token", q.token).with("num", q.num).with("expiresAt", q.expiresAt)
                .with("qrText", props.qrBaseUrl() + "/qr?t=" + q.token));
    }

    /** Desktop polls. On APPROVED the tokens are returned once and the session becomes CONSUMED. */
    @PublicApi
    @GetMapping("/qr/{token}")
    @Transactional
    public ApiResponse qrPoll(@PathVariable String token, HttpServletRequest req) {
        QrLoginSession q = qrs.findByToken(token).orElseThrow(() -> ApiException.notFound("QR 로그인 세션이 없습니다."));
        if ("PENDING".equals(q.status) && q.expiresAt.isBefore(Times.now())) { q.status = "EXPIRED"; qrs.save(q); }
        Json res = Json.obj().with("status", q.status).with("num", q.num).with("expiresAt", q.expiresAt);
        if ("APPROVED".equals(q.status)) {
            q.status = "CONSUMED";
            qrs.save(q);
            AppUser u = users.findById(q.userId).orElseThrow();
            res.putAll(tokens(u, req, "QR"));
            res.put("status", "APPROVED");
        }
        return ApiResponse.ok(res);
    }

    /** Phone (already signed in): shows the 2-digit number for the user to compare, then approves. */
    @GetMapping("/qr/{token}/info")
    public ApiResponse qrInfo(@PathVariable String token) {
        QrLoginSession q = qrs.findByToken(token).orElseThrow(() -> ApiException.notFound("QR 로그인 세션이 없습니다."));
        boolean expired = !"PENDING".equals(q.status) || q.expiresAt.isBefore(Times.now());
        return ApiResponse.ok(Json.obj().with("status", expired ? (q.status.equals("PENDING") ? "EXPIRED" : q.status) : "PENDING")
                .with("num", q.num).with("clientIp", maskIp(q.clientIp)).with("expiresAt", q.expiresAt));
    }

    @PostMapping("/qr/{token}/approve")
    @Transactional
    public ApiResponse qrApprove(@PathVariable String token, @RequestBody(required = false) Map<String, Object> body) {
        CurrentUser me = AuthContext.get();
        QrLoginSession q = qrs.findByToken(token).orElseThrow(() -> ApiException.notFound("QR 로그인 세션이 없습니다."));
        if (!"PENDING".equals(q.status) || q.expiresAt.isBefore(Times.now())) throw ApiException.conflict("만료되었거나 이미 처리된 QR입니다.");
        String num = body == null ? null : Params.str(body, "num");
        if (num != null && !num.equals(q.num)) throw ApiException.badRequest("확인 숫자가 일치하지 않습니다.");
        q.status = "APPROVED"; q.userId = me.userId(); q.approvedAt = Times.now();
        qrs.save(q);
        return ApiResponse.ok(Json.obj().with("status", "APPROVED"));
    }

    @PostMapping("/qr/{token}/reject")
    @Transactional
    public ApiResponse qrReject(@PathVariable String token) {
        AuthContext.get();
        QrLoginSession q = qrs.findByToken(token).orElseThrow(() -> ApiException.notFound("QR 로그인 세션이 없습니다."));
        if ("PENDING".equals(q.status)) { q.status = "REJECTED"; qrs.save(q); }
        return ApiResponse.ok(Json.obj().with("status", q.status));
    }

    // ---------- tokens / me ----------

    @PublicApi
    @PostMapping("/refresh")
    public ApiResponse refresh(@RequestBody Map<String, Object> body) {
        AppUser u;
        try {
            Claims c = jwt.parse(Params.rawStr(body, "refreshToken"));
            if (!"refresh".equals(c.get("type"))) throw new IllegalArgumentException();
            u = users.findById(Long.valueOf(c.getSubject())).orElseThrow();
        } catch (Exception e) {
            throw ApiException.unauthorized("다시 로그인해 주세요.");
        }
        if (!"ACTIVE".equals(u.status)) throw ApiException.unauthorized("다시 로그인해 주세요.");
        return ApiResponse.ok(jwt.issue(u));
    }

    @GetMapping("/me")
    public ApiResponse me() {
        return ApiResponse.ok(me(AuthContext.get().user()));
    }

    /** 회원정보 수정: 이름·직위·휴대전화·이메일·OTP 사용 여부만 본인이 바꿀 수 있다. */
    @PutMapping("/me")
    @Transactional
    public ApiResponse updateMe(@RequestBody Map<String, Object> b) {
        AppUser u = users.findById(AuthContext.get().userId()).orElseThrow();
        if (b.containsKey("userName") && Params.str(b, "userName") != null) u.userName = Params.str(b, "userName");
        if (b.containsKey("positionName")) u.positionName = Params.str(b, "positionName");
        if (b.containsKey("mobile")) u.mobile = Params.str(b, "mobile");
        if (b.containsKey("email")) u.email = Params.str(b, "email");
        if (b.containsKey("otpEnabled")) u.otpEnabled = Boolean.parseBoolean(String.valueOf(b.get("otpEnabled")));
        users.save(u);
        return ApiResponse.ok(me(u));
    }

    @PutMapping("/password")
    @Transactional
    public ApiResponse changePassword(@RequestBody Map<String, Object> b) {
        AppUser u = users.findById(AuthContext.get().userId()).orElseThrow();
        String cur = Params.rawStr(b, "currentPassword"), next = Params.rawStr(b, "newPassword");
        if (Params.blank(cur) || !encoder.matches(cur, u.password)) throw ApiException.badRequest("현재 비밀번호가 올바르지 않습니다.");
        PasswordPolicy.check(next, u.loginId, u.mobile);
        if (encoder.matches(next, u.password)) throw ApiException.badRequest("이전 비밀번호와 다른 비밀번호를 사용해 주세요.");
        u.password = encoder.encode(next);
        u.passwordChangedAt = Times.now();
        users.save(u);
        return ApiResponse.ok(Json.obj().with("passwordChangedAt", u.passwordChangedAt));
    }

    /** 최근 로그인 기록 5건 (IP 일부 마스킹). */
    @GetMapping("/me/logins")
    public ApiResponse myLogins() {
        List<Json> list = logins.findTop5ByUserIdOrderByLoginAtDesc(AuthContext.get().userId()).stream()
                .map(h -> Json.obj().with("loginAt", h.loginAt).with("ip", maskIp(h.ip)).with("method", h.method)
                        .with("success", h.success).with("userAgent", h.userAgent))
                .toList();
        return ApiResponse.ok(list);
    }

    // ---------- menu scraps ----------

    @GetMapping("/me/scraps")
    public ApiResponse scraps() {
        return ApiResponse.ok(scraps.findByUserIdOrderByCreatedAtAsc(AuthContext.get().userId()).stream()
                .map(s -> Json.obj().with("scrapId", s.scrapId).with("menuKey", s.menuKey).with("groupName", s.groupName).with("title", s.title)).toList());
    }

    @PostMapping("/me/scraps")
    @Transactional
    public ApiResponse addScrap(@RequestBody Map<String, Object> b) {
        Long uid = AuthContext.get().userId();
        String key = Params.str(b, "menuKey");
        if (key == null) throw ApiException.badRequest("메뉴를 선택해 주세요.");
        MenuScrap s = scraps.findByUserIdAndMenuKey(uid, key).orElseGet(MenuScrap::new);
        s.userId = uid; s.menuKey = key; s.groupName = Params.str(b, "groupName"); s.title = Params.str(b, "title");
        if (s.createdAt == null) s.createdAt = Times.now();
        scraps.save(s);
        return ApiResponse.ok(Json.obj().with("scrapId", s.scrapId));
    }

    @DeleteMapping("/me/scraps/{id}")
    @Transactional
    public ApiResponse deleteScrap(@PathVariable Long id) {
        scraps.findById(id).filter(s -> s.userId.equals(AuthContext.get().userId())).ifPresent(scraps::delete);
        return ApiResponse.ok(null);
    }
}
