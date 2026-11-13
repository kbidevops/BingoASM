package com.bingoasm.service;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.AppUser;
import com.bingoasm.domain.as.Region;
import com.bingoasm.domain.as.School;
import com.bingoasm.domain.as.Vendor;
import com.bingoasm.repo.UserRepository;
import com.bingoasm.repo.as.RegionRepository;
import com.bingoasm.repo.as.SchoolRepository;
import com.bingoasm.repo.as.VendorRepository;
import com.bingoasm.service.as.AssetBulkService;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.SecureRandom;
import java.util.*;
import java.util.regex.Pattern;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.util.CellRangeAddressList;
import org.apache.poi.xssf.usermodel.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 사용자 일괄 등록(엑셀): 양식 → 검증(행별 오류) → 확정. 자산 일괄 등록과 같은 흐름이다.
 * 한 행의 검사는 사용자 등록 화면과 같은 UserService.prepareNew(권한 · 아이디 중복 · 역할 · 소속 · 비밀번호 규칙)를 쓴다.
 * 초기 비밀번호를 비우면 서버가 규칙에 맞는 임시 비밀번호를 만들어 등록 결과에서 한 번만 보여 준다 (다시 볼 수 없다).
 */
@Service
@Transactional
public class UserBulkService {
    public static final List<String> HEAD = List.of("아이디", "이름", "회원유형", "소속", "직위", "휴대폰", "이메일", "초기 비밀번호");
    public static final int MAX_ROWS = 500;
    private static final int PW = 7;

    /** 회원유형 이름 → 역할. 시스템·통합 관리자와 기존 자산관리 역할은 일괄 등록하지 않는다. */
    static final Map<String, String> TYPE_NAME = new LinkedHashMap<>();
    static {
        TYPE_NAME.put("학교 담당자", "SCHOOL_USER");
        TYPE_NAME.put("AS 기사", "AS_ENGINEER");
        TYPE_NAME.put("업체 관리자", "VENDOR_ADMIN");
        TYPE_NAME.put("교육지원청 담당자", "REGION_ADMIN");
        TYPE_NAME.put("교육청 관리자", "EDU_ADMIN");
    }
    private static final Map<String, String> TYPE_ALIAS = new HashMap<>();
    static {
        TYPE_NAME.forEach((k, v) -> TYPE_ALIAS.put(AssetBulkService.norm(k), v));
        TYPE_ALIAS.put("학교", "SCHOOL_USER"); TYPE_ALIAS.put("기사", "AS_ENGINEER"); TYPE_ALIAS.put("as기사", "AS_ENGINEER");
        TYPE_ALIAS.put("교육지원청", "REGION_ADMIN"); TYPE_ALIAS.put("교육청", "EDU_ADMIN");
    }
    private static final Pattern LOGIN_ID = Pattern.compile("[A-Za-z0-9._-]{3,50}");
    private static final Pattern EMAIL = Pattern.compile("[^\\s@]+@[^\\s@]+\\.[^\\s@]+");

    private final UserService userService;
    private final UserRepository users;
    private final SchoolRepository schools;
    private final VendorRepository vendors;
    private final RegionRepository regions;
    private final SecureRandom random = new SecureRandom();

    public UserBulkService(UserService userService, UserRepository users, SchoolRepository schools, VendorRepository vendors, RegionRepository regions) {
        this.userService = userService; this.users = users; this.schools = schools; this.vendors = vendors; this.regions = regions;
    }

    /**
     * 일괄 등록은 사용자 등록 화면과 같은 범위다: 도교육청(역할 부여 권한) = 전체, 교육지원청 = 관내 학교 담당자 + 관할 지역만 맡는 업체의
     * 기사 · 업체 관리자, 업체 = 자기 업체 기사, 학교 = 자기 학교 담당자. 행마다 UserService.prepareNew가 같은 규칙으로 다시 확인한다.
     */
    private void requireAdmin(CurrentUser me) { userService.requireBulkUserAdmin(me); }

    /** 이 계정이 일괄 등록할 수 있는 회원유형 (이름 → 역할). */
    private Map<String, String> typesFor(CurrentUser me) {
        List<String> allowed = userService.manageableRolesOf(me);
        Map<String, String> m = new LinkedHashMap<>();
        TYPE_NAME.forEach((k, v) -> { if (allowed == null || allowed.contains(v)) m.put(k, v); });
        return m;
    }

    // ---------- template ----------

    @Transactional(readOnly = true)
    public byte[] template(CurrentUser me) throws IOException {
        requireAdmin(me);
        Map<String, String> types = typesFor(me);
        // 이 계정이 등록할 수 있는 유형의 소속만 (범위 밖 학교 · 업체 · 교육지원청은 목록에 없다)
        List<School> ss = types.containsValue("SCHOOL_USER") ? schools.findByOrgIdAndUseYnOrderBySchoolNameAsc(me.orgId(), "Y").stream()
                .filter(s -> userService.schoolInScope(me, s)).toList() : List.of();
        List<Vendor> vs = types.containsValue("AS_ENGINEER") || types.containsValue("VENDOR_ADMIN") ? vendors.findByOrgIdAndUseYnOrderByVendorNameAsc(me.orgId(), "Y").stream()
                .filter(v -> userService.vendorInScope(me, v.vendorId)).toList() : List.of();
        List<Region> rs = types.containsValue("REGION_ADMIN") ? regions.findByOrgIdOrderBySortOrderAsc(me.orgId()).stream().filter(Region::active).toList() : List.of();
        try (XSSFWorkbook wb = new XSSFWorkbook()) {
            XSSFSheet sh = wb.createSheet("사용자");
            CellStyle head = wb.createCellStyle();
            Font bold = wb.createFont(); bold.setBold(true); head.setFont(bold);
            head.setFillForegroundColor(IndexedColors.GREY_25_PERCENT.getIndex()); head.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            head.setBorderBottom(BorderStyle.THIN);
            // 휴대폰 · 비밀번호는 글자로 (0으로 시작하는 번호, 숫자로 바뀌는 비밀번호 방지)
            CellStyle text = wb.createCellStyle();
            text.setDataFormat(wb.createDataFormat().getFormat("@"));
            Row h = sh.createRow(0);
            for (int i = 0; i < HEAD.size(); i++) { Cell c = h.createCell(i); c.setCellValue(HEAD.get(i)); c.setCellStyle(head); }
            List<String[]> sl = new ArrayList<>();
            if (types.containsValue("SCHOOL_USER")) sl.add(new String[]{"school_hong", "홍길동", "학교 담당자", ss.isEmpty() ? "봉황초등학교" : ss.get(0).schoolName, "정보부장", "010-1234-5678", "hong@example.go.kr", ""});
            if (types.containsValue("AS_ENGINEER")) sl.add(new String[]{"eng_kim", "김기사", "AS 기사", vs.isEmpty() ? "한빛네트웍스" : vs.get(0).vendorName, "기술과장", "010-2345-6789", "", ""});
            String[][] sample = sl.toArray(String[][]::new);
            for (int r = 0; r < sample.length; r++) {
                Row row = sh.createRow(r + 1);
                for (int c = 0; c < sample[r].length; c++) row.createCell(c).setCellValue(sample[r][c]);
            }
            int[] widths = {16, 12, 18, 24, 12, 16, 26, 18};
            for (int i = 0; i < widths.length; i++) sh.setColumnWidth(i, widths[i] * 256);
            sh.setDefaultColumnStyle(5, text);
            sh.setDefaultColumnStyle(PW, text);
            sh.createFreezePane(0, 1);
            XSSFDataValidationHelper dv = new XSSFDataValidationHelper(sh);
            DataValidation v = dv.createValidation(dv.createExplicitListConstraint(types.keySet().toArray(String[]::new)),
                    new CellRangeAddressList(1, MAX_ROWS, 2, 2));
            v.setShowErrorBox(false); v.setSuppressDropDownArrow(true);
            sh.addValidationData(v);

            XSSFSheet guide = wb.createSheet("안내");
            String[][] g = {
                    {"열", "입력 규칙"},
                    {"아이디", "영문 · 숫자 · . _ - 로 3~50자. 이미 있는 아이디나 파일 안에서 겹치는 아이디는 등록되지 않습니다."},
                    {"이름", "50자 이내."},
                    {"회원유형", String.join(" / ", types.keySet()) + (me.scope().province() ? ". 시스템 관리자는 사용자 관리 화면에서 한 명씩 등록합니다." : ". 이 계정이 등록할 수 있는 유형만입니다.")},
                    {"소속", affGuide(types)},
                    {"직위", "선택. 50자 이내."},
                    {"휴대폰", "선택. 예: 010-1234-5678. 알림 · 문의처에 쓰입니다."},
                    {"이메일", "선택."},
                    {"초기 비밀번호", "선택. 9~20자, 영문 · 숫자 · 특수문자 포함, 아이디 · 휴대폰 번호 포함 금지. 비우면 임시 비밀번호를 만들어 등록 결과에서 한 번만 보여 줍니다."},
                    {"범위", userService.scopeRuleOf(me) == null ? "도교육청 관리자: 모든 학교 · 업체 · 교육지원청의 계정을 등록할 수 있습니다." : userService.scopeRuleOf(me) + " 소속을 비우면 " + (me.scope().school() ? "자기 학교" : me.scope().vendor() ? "자기 업체" : "-") + "로 넣습니다."},
                    {"행 수", "한 번에 최대 " + MAX_ROWS + "행. 예시 행은 지우고 올려 주세요."},
                    {"보안", "비밀번호를 적은 파일은 등록이 끝나면 지우세요. 계정을 받은 사람은 첫 로그인 뒤 마이페이지에서 비밀번호를 바꾸게 안내하세요."}};
            for (int r = 0; r < g.length; r++) { Row row = guide.createRow(r); for (int c = 0; c < g[r].length; c++) { Cell cell = row.createCell(c); cell.setCellValue(g[r][c]); if (r == 0) cell.setCellStyle(head); } }
            guide.setColumnWidth(0, 16 * 256); guide.setColumnWidth(1, 100 * 256);

            XSSFSheet aff = wb.createSheet("소속 목록");
            Row ah = aff.createRow(0);
            String[] ahead = {"구분", "이름", "쓰는 회원유형"};
            for (int i = 0; i < ahead.length; i++) { Cell c = ah.createCell(i); c.setCellValue(ahead[i]); c.setCellStyle(head); }
            int ri = 1;
            for (School s : ss) ri = affRow(aff, ri, "학교", s.schoolName, "학교 담당자");
            for (Vendor x : vs) ri = affRow(aff, ri, "업체", x.vendorName, "AS 기사 · 업체 관리자");
            for (Region r : rs) ri = affRow(aff, ri, "교육지원청", r.regionName, "교육지원청 담당자");
            aff.setColumnWidth(0, 12 * 256); aff.setColumnWidth(1, 28 * 256); aff.setColumnWidth(2, 24 * 256);

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            wb.write(out);
            return out.toByteArray();
        }
    }

    /** 안내 시트의 소속 설명: 이 계정이 등록할 수 있는 유형만. */
    private static String affGuide(Map<String, String> types) {
        List<String> l = new ArrayList<>();
        if (types.containsValue("SCHOOL_USER")) l.add("학교 담당자 → 학교 이름");
        if (types.containsValue("AS_ENGINEER") || types.containsValue("VENDOR_ADMIN")) l.add("AS 기사 · 업체 관리자 → 업체 이름");
        if (types.containsValue("REGION_ADMIN")) l.add("교육지원청 담당자 → 교육지원청 이름");
        return String.join(", ", l) + " (‘소속 목록’ 시트 참고)." + (types.containsValue("EDU_ADMIN") ? " 교육청 관리자는 비워 둡니다." : "");
    }

    private static int affRow(XSSFSheet sh, int ri, String kind, String name, String use) {
        Row row = sh.createRow(ri);
        row.createCell(0).setCellValue(kind); row.createCell(1).setCellValue(name); row.createCell(2).setCellValue(use);
        return ri + 1;
    }

    // ---------- validate ----------

    private record Checked(int rowNo, List<String> cells, List<String> errors, String warning, Map<String, Object> body, boolean generated) {}

    @Transactional(readOnly = true)
    public Json validate(CurrentUser me, MultipartFile file) throws IOException {
        return view(check(me, read(file)));
    }

    private List<List<String>> read(MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) throw ApiException.badRequest("엑셀 파일(.xlsx)을 선택해 주세요.");
        String name = Optional.ofNullable(file.getOriginalFilename()).orElse("");
        if (!name.toLowerCase().endsWith(".xlsx")) throw ApiException.badRequest("xlsx 형식만 올릴 수 있습니다.");
        return AssetBulkService.readRows(file.getInputStream(), HEAD.size(), MAX_ROWS);
    }

    private List<Checked> check(CurrentUser me, List<List<String>> rows) {
        requireAdmin(me);
        Map<String, String> types = typesFor(me);
        if (rows.isEmpty()) throw ApiException.badRequest("빈 파일입니다. 양식을 내려받아 작성해 주세요.");
        List<String> head = rows.get(0).stream().map(s -> s == null ? "" : s.trim()).toList();
        for (int i = 0; i < HEAD.size(); i++)
            if (i >= head.size() || !HEAD.get(i).equals(head.get(i)))
                throw ApiException.badRequest("양식이 다릅니다. " + (i + 1) + "번째 열은 '" + HEAD.get(i) + "'이어야 합니다. 양식을 다시 내려받아 주세요.");
        List<List<String>> body = rows.subList(1, rows.size()).stream().filter(r -> r.stream().anyMatch(c -> c != null && !c.isBlank())).toList();
        if (body.isEmpty()) throw ApiException.badRequest("등록할 행이 없습니다.");
        if (body.size() > MAX_ROWS) throw ApiException.badRequest("한 번에 최대 " + MAX_ROWS + "행까지 올릴 수 있습니다. (" + body.size() + "행)");

        Map<String, List<School>> schoolByName = new HashMap<>();
        for (School s : schools.findByOrgIdAndUseYnOrderBySchoolNameAsc(me.orgId(), "Y")) schoolByName.computeIfAbsent(AssetBulkService.norm(s.schoolName), k -> new ArrayList<>()).add(s);
        Map<String, List<Vendor>> vendorByName = new HashMap<>();
        for (Vendor v : vendors.findByOrgIdAndUseYnOrderByVendorNameAsc(me.orgId(), "Y")) vendorByName.computeIfAbsent(AssetBulkService.norm(v.vendorName), k -> new ArrayList<>()).add(v);
        Map<String, Region> regionByName = new HashMap<>();
        for (Region r : regions.findByOrgIdOrderBySortOrderAsc(me.orgId())) if (r.active()) {
            regionByName.put(AssetBulkService.norm(r.regionName), r);
            regionByName.putIfAbsent(AssetBulkService.norm(r.regionName + "교육지원청"), r);
        }
        Map<String, Integer> firstRow = new HashMap<>();

        List<Checked> out = new ArrayList<>();
        for (int i = 0; i < body.size(); i++) {
            int rowNo = i + 2;
            List<String> r = body.get(i);
            List<String> cells = new ArrayList<>();
            for (int c = 0; c < HEAD.size(); c++) cells.add(c < r.size() && r.get(c) != null ? (c == PW ? r.get(c) : r.get(c).trim()) : "");
            List<String> errors = new ArrayList<>();
            String warning = null;
            for (int c = 0; c < cells.size(); c++)
                if (AssetBulkService.looksLikeFormula(cells.get(c))) errors.add(HEAD.get(c) + ": =, +, -, @로 시작할 수 없습니다.");

            String loginId = cells.get(0), name = cells.get(1), type = cells.get(2), aff = cells.get(3);
            if (loginId.isEmpty()) errors.add("아이디를 입력하세요.");
            else if (!LOGIN_ID.matcher(loginId).matches()) errors.add("아이디는 영문 · 숫자 · . _ - 로 3~50자여야 합니다: " + loginId);
            else {
                Integer prev = firstRow.putIfAbsent(loginId.toLowerCase(), rowNo);
                if (prev != null) errors.add("아이디 '" + loginId + "'이(가) " + prev + "행과 겹칩니다.");
            }
            if (name.isEmpty()) errors.add("이름을 입력하세요.");
            else if (name.length() > 50) errors.add("이름은 50자 이내여야 합니다.");
            if (cells.get(4).length() > 50) errors.add("직위는 50자 이내여야 합니다.");

            String role = TYPE_ALIAS.get(AssetBulkService.norm(type));
            if (type.isEmpty()) errors.add("회원유형을 입력하세요.");
            else if (role == null) errors.add("회원유형 '" + type + "'은(는) 쓸 수 없습니다. (" + String.join(" / ", types.keySet()) + ")");
            else if (!types.containsValue(role)) { errors.add("이 계정은 '" + type + "'을(를) 등록할 수 없습니다. 등록할 수 있는 유형: " + String.join(" / ", types.keySet())); role = null; }

            Map<String, Object> b = new LinkedHashMap<>();
            b.put("loginId", loginId); b.put("userName", name);
            if (role != null) b.put("roles", List.of(role));
            b.put("positionName", blankToNull(cells.get(4)));
            String mobile = mobile(cells.get(5));
            if (mobile == null && !cells.get(5).isEmpty()) errors.add("휴대폰 번호 형식이 올바르지 않습니다: " + cells.get(5));
            b.put("mobile", mobile);
            String email = cells.get(6);
            if (!email.isEmpty() && (email.length() > 100 || !EMAIL.matcher(email).matches())) errors.add("이메일 형식이 올바르지 않습니다: " + email);
            b.put("email", blankToNull(email));

            if (role != null) {
                // 학교 · 업체 계정은 소속을 비우면 자기 학교 · 업체
                if (aff.isEmpty() && "SCHOOL_USER".equals(role) && me.scope().school() && me.scope().schoolId() != null)
                    aff = schools.findById(me.scope().schoolId()).map(s -> s.schoolName).orElse("");
                if (aff.isEmpty() && ("AS_ENGINEER".equals(role) || "VENDOR_ADMIN".equals(role)) && me.scope().vendor() && me.scope().vendorId() != null)
                    aff = vendors.findById(me.scope().vendorId()).map(v -> v.vendorName).orElse("");
                if (!aff.equals(cells.get(3))) cells.set(3, aff);
                String a = AssetBulkService.norm(aff);
                switch (role) {
                    case "SCHOOL_USER" -> {
                        List<School> m = schoolByName.getOrDefault(a, List.of());
                        if (aff.isEmpty()) errors.add("학교 담당자는 소속 학교를 입력하세요.");
                        else if (m.isEmpty()) errors.add("학교 '" + aff + "'을(를) 찾을 수 없습니다.");
                        else if (m.size() > 1) errors.add("이름이 '" + aff + "'인 학교가 " + m.size() + "곳입니다. 학교 관리에서 이름을 구분해 주세요.");
                        else if (!userService.schoolInScope(me, m.get(0))) errors.add("학교 '" + aff + "'은(는) 이 계정이 다룰 수 없는 학교입니다. " + userService.scopeRuleOf(me));
                        else b.put("schoolId", m.get(0).schoolId);
                    }
                    case "AS_ENGINEER", "VENDOR_ADMIN" -> {
                        List<Vendor> m = vendorByName.getOrDefault(a, List.of());
                        if (aff.isEmpty()) errors.add("AS 기사 · 업체 관리자는 소속 업체를 입력하세요.");
                        else if (m.isEmpty()) errors.add("업체 '" + aff + "'을(를) 찾을 수 없습니다.");
                        else if (m.size() > 1) errors.add("이름이 '" + aff + "'인 업체가 " + m.size() + "곳입니다.");
                        else if (!userService.vendorInScope(me, m.get(0).vendorId)) errors.add("업체 '" + aff + "'은(는) 이 계정이 다룰 수 없는 업체입니다. " + userService.scopeRuleOf(me));
                        else b.put("vendorId", m.get(0).vendorId);
                    }
                    case "REGION_ADMIN" -> {
                        Region m = regionByName.get(a);
                        if (aff.isEmpty()) errors.add("교육지원청 담당자는 소속 교육지원청을 입력하세요.");
                        else if (m == null) errors.add("교육지원청 '" + aff + "'을(를) 찾을 수 없습니다.");
                        else b.put("regionId", m.regionId);
                    }
                    default -> { if (!aff.isEmpty()) warning = "교육청 관리자는 소속을 쓰지 않아 '" + aff + "'은(는) 무시합니다."; }
                }
            }

            String pw = cells.get(PW);
            boolean generated = pw.isEmpty();
            b.put("password", generated ? tempPassword(loginId, mobile) : pw);
            if (errors.isEmpty()) {
                try { userService.prepareNew(me, b, false); }
                catch (ApiException e) { errors.add(e.getMessage()); }
            }
            out.add(new Checked(rowNo, cells, errors, warning, b, generated));
        }
        return out;
    }

    private Json view(List<Checked> rows) {
        long ok = rows.stream().filter(x -> x.errors().isEmpty()).count();
        List<Json> rj = rows.stream().map(x -> {
            // 비밀번호는 돌려주지 않는다 (화면 · 응답 로그에 남지 않게).
            List<String> cells = new ArrayList<>(x.cells());
            cells.set(PW, x.generated() ? "(자동 생성)" : "●●●●●●");
            return Json.obj().with("rowNo", x.rowNo()).with("cells", cells).with("errors", x.errors()).with("ok", x.errors().isEmpty())
                    .with("warning", x.warning());
        }).toList();
        return Json.obj().with("head", HEAD).with("total", (long) rows.size()).with("ok", ok).with("error", rows.size() - ok).with("rows", rj);
    }

    // ---------- commit ----------

    /** 다시 검사한 뒤 오류 없는 행만 등록 (오류가 있으면 skipErrors일 때만). 한 트랜잭션이라 중간에 실패하면 아무것도 등록되지 않는다. */
    public Json commit(CurrentUser me, MultipartFile file, boolean skipErrors) throws IOException {
        List<Checked> rows = check(me, read(file));
        long errors = rows.stream().filter(x -> !x.errors().isEmpty()).count();
        if (errors > 0 && !skipErrors) throw ApiException.badRequest("오류가 있는 행이 " + errors + "개 있습니다. 고친 뒤 다시 올리거나 오류 행을 빼고 등록하세요.");
        if (errors == rows.size()) throw ApiException.badRequest("등록할 수 있는 행이 없습니다.");
        List<Json> created = new ArrayList<>();
        for (Checked x : rows) {
            if (!x.errors().isEmpty()) continue;
            AppUser u = userService.saveNew(userService.prepareNew(me, x.body(), true));
            String type = TYPE_NAME.entrySet().stream().filter(e -> u.roles.contains(e.getValue())).map(Map.Entry::getKey).findFirst().orElse("");
            created.add(Json.obj().with("rowNo", x.rowNo()).with("userId", u.userId).with("loginId", u.loginId).with("userName", u.userName)
                    .with("typeName", type).with("affiliation", x.cells().get(3))
                    // 서버가 만든 임시 비밀번호만, 이 응답에서 한 번 (저장된 것은 해시뿐이라 다시 볼 수 없다)
                    .with("tempPassword", x.generated() ? String.valueOf(x.body().get("password")) : null));
        }
        return Json.obj().with("created", (long) created.size()).with("skipped", errors).with("users", created);
    }

    // ---------- helpers ----------

    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s; }

    /** 010-1234-5678 꼴로. 엑셀이 숫자로 바꿔 앞의 0이 빠진 번호(1012345678)도 받는다. 틀리면 null. */
    static String mobile(String s) {
        if (s == null || s.isBlank()) return null;
        String d = s.replaceAll("[\\s\\-().]", "");
        if (!d.matches("\\d+")) return null;
        if (d.length() == 10 && d.startsWith("10")) d = "0" + d;
        if (d.length() == 11 && d.startsWith("01")) return d.substring(0, 3) + "-" + d.substring(3, 7) + "-" + d.substring(7);
        if (d.length() == 10 && d.startsWith("0")) return d.substring(0, 3) + "-" + d.substring(3, 6) + "-" + d.substring(6);
        if (d.length() >= 9 && d.length() <= 12 && d.startsWith("0")) return d;
        return null;
    }

    private static final String UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ", LOWER = "abcdefghijkmnpqrstuvwxyz", DIGITS = "23456789", SPECIAL = "!#$%*?";

    /** 규칙(9~20자, 영문 · 숫자 · 특수문자, 아이디 · 번호 포함 금지)에 맞는 12자 임시 비밀번호. 헷갈리는 글자(0 O 1 l I)는 뺀다. */
    String tempPassword(String loginId, String mobile) {
        for (int tries = 0; tries < 20; tries++) {
            List<Character> cs = new ArrayList<>();
            for (int i = 0; i < 3; i++) cs.add(pick(UPPER));
            for (int i = 0; i < 4; i++) cs.add(pick(LOWER));
            for (int i = 0; i < 3; i++) cs.add(pick(DIGITS));
            for (int i = 0; i < 2; i++) cs.add(pick(SPECIAL));
            Collections.shuffle(cs, random);
            // 첫 글자는 영문 (엑셀 · CSV에서 수식으로 읽히지 않게)
            int letter = 0;
            while (!Character.isLetter(cs.get(letter))) letter++;
            Collections.swap(cs, 0, letter);
            StringBuilder sb = new StringBuilder();
            cs.forEach(sb::append);
            String pw = sb.toString();
            try { PasswordPolicy.check(pw, loginId, mobile); return pw; } catch (ApiException ignored) { }
        }
        throw ApiException.badRequest("임시 비밀번호를 만들지 못했습니다. 초기 비밀번호를 직접 적어 주세요.");
    }

    private char pick(String s) { return s.charAt(random.nextInt(s.length())); }
}
