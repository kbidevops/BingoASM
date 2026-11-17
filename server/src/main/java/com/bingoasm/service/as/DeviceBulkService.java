package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.ApiException;
import com.bingoasm.common.Json;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.as.WirelessDeviceRepository;
import java.io.IOException;
import java.time.LocalDate;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 무선망(M) · 스쿨넷(S) 장비 일괄 등록: 양식 → 검증 → 확정. 한 행의 저장은 장비 등록 화면과 같은 WirelessDeviceService.newDevice
 * (학교 범위 · 장비 구분 · 상태 · 유지보수 업체 확인, 업체를 비우면 학교의 담당 업체)를 쓴다. 도면 배치는 하지 않는다 (설치위치 글자만).
 */
@Service
@Transactional
public class DeviceBulkService {
    static final int MAX_ROWS = 2000;
    private static final List<String> M_HEAD = List.of("학교명", "장비명", "장비 구분", "장비번호", "모델명", "IP 주소", "MAC 주소", "설치위치", "설치일", "최근 점검일", "상태", "유지보수 업체", "비고");
    private static final List<String> S_HEAD = List.of("학교명", "장비명", "장비 구분", "장비번호", "모델명", "통신사", "회선번호", "회선 속도", "IP 주소", "MAC 주소", "설치위치", "설치일", "최근 점검일", "상태", "유지보수 업체", "비고");
    private static final Map<String, List<String>> TYPE_ORDER = Map.of("M", List.of("AP", "SWITCH", "CONTROLLER"), "S", List.of("ROUTER", "L3", "L2", "FIREWALL", "ETC"));
    private static final List<String> STATUS_ORDER = List.of("NORMAL", "CHECK", "FAULT", "DISPOSED");
    private static final Pattern IPV4 = Pattern.compile("((25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1?\\d?\\d)");
    private static final Pattern IPV6 = Pattern.compile("[0-9A-Fa-f:.]{2,45}");

    private final WirelessDeviceService deviceService;
    private final SchoolService schoolService;
    private final WirelessDeviceRepository devices;

    public DeviceBulkService(WirelessDeviceService deviceService, SchoolService schoolService, WirelessDeviceRepository devices) {
        this.deviceService = deviceService; this.schoolService = schoolService; this.devices = devices;
    }

    static List<String> head(String ty) { return "S".equals(ty) ? S_HEAD : M_HEAD; }
    private static String noun(String ty) { return "S".equals(ty) ? "스쿨넷 장비" : "무선장비"; }
    private static Map<String, String> types(String ty) { return WirelessDeviceService.TYPES.get(ty); }
    private static List<String> typeNames(String ty) { return TYPE_ORDER.get(ty).stream().map(types(ty)::get).toList(); }

    /** 이 계정이 장비를 넣을 수 있는 학교 (학교 · 교육지원청 · 업체는 범위 안만). */
    private List<School> schoolsFor(CurrentUser me) {
        Set<Long> scope = schoolService.scopeSchoolIds(me);
        return schoolService.schoolMap(me.orgId()).values().stream().filter(s -> scope == null || scope.contains(s.schoolId))
                .sorted(Comparator.comparing(s -> s.schoolName)).toList();
    }

    private List<Vendor> vendorsFor(CurrentUser me, String ty) {
        return schoolService.vendorMap(me.orgId()).values().stream().filter(v -> v.serviceTypeList().contains(ty)).sorted(Comparator.comparing(v -> v.vendorName)).toList();
    }

    // ---------- template ----------

    @Transactional(readOnly = true)
    public byte[] template(CurrentUser me, String ty) throws IOException {
        List<String> head = head(ty);
        List<School> ss = schoolsFor(me);
        Map<Long, Region> rm = schoolService.regionMap(me.orgId());
        Map<Long, Vendor> vm = schoolService.allVendorMap(me.orgId());
        String school = ss.isEmpty() ? "봉황초등학교" : ss.get(0).schoolName;
        boolean s = "S".equals(ty);
        List<List<String>> samples = s
                ? List.of(List.of(school, "본관 라우터", "라우터", "", "Cisco ISR4331", "KT", "KT-1234-5678", "500Mbps", "10.10.1.1", "", "본관 1층 전산실", "2024-03-02", "", "정상", "", ""))
                : List.of(List.of(school, "본관 2층 복도 AP", "무선 AP", "", "Aruba AP-515", "10.20.2.11", "AA:BB:CC:00:11:22", "본관 2층 복도", "2024-03-02", "", "정상", "", ""),
                          List.of(school, "본관 PoE 스위치", "PoE 스위치", "", "", "10.20.0.2", "", "본관 1층 전산실", "", "", "정상", "", ""));
        int[] widths = s ? new int[]{22, 22, 14, 12, 18, 10, 18, 12, 16, 20, 22, 14, 14, 10, 18, 24} : new int[]{22, 22, 14, 12, 18, 16, 20, 22, 14, 14, 10, 18, 24};
        Map<Integer, List<String>> drop = new HashMap<>();
        drop.put(2, typeNames(ty));
        drop.put(head.indexOf("상태"), STATUS_ORDER.stream().map(WirelessDeviceService.STATUS_NAME::get).toList());
        Set<Integer> text = new HashSet<>(List.of(3, head.indexOf("IP 주소"), head.indexOf("MAC 주소")));
        if (s) text.add(head.indexOf("회선번호"));

        List<String[]> guide = new ArrayList<>();
        guide.add(new String[]{"학교명", "필수. ‘학교 목록’ 시트의 이름. 이 계정이 다룰 수 있는 학교만 됩니다."});
        guide.add(new String[]{"장비명", "필수. 100자 이내. 예: 본관 2층 복도 AP"});
        guide.add(new String[]{"장비 구분", (s ? "필수. " : "선택 (비우면 무선 AP). ") + String.join(" / ", typeNames(ty))});
        guide.add(new String[]{"장비번호", "선택. 30자 이내. 비우면 " + (s ? "N-0001" : "W-0001") + "처럼 자동으로 붙습니다. 이미 쓰는 번호나 파일 안에서 겹치는 번호는 등록되지 않습니다. 라벨 QR에 찍히는 번호입니다."});
        if (s) guide.add(new String[]{"통신사 · 회선번호 · 회선 속도", "선택. 예: KT · KT-1234-5678 · 500Mbps"});
        guide.add(new String[]{"IP 주소 · MAC 주소", "선택. IP는 10.20.2.11 꼴, MAC은 AA:BB:CC:00:11:22 (- 나 구분 없이 적어도 됩니다)."});
        guide.add(new String[]{"설치위치", "선택. 예: 본관 2층 복도. 도면 위치는 등록 뒤 ‘무선장비 위치(도면)’에서 놓습니다."});
        guide.add(new String[]{"설치일 · 최근 점검일", "선택. YYYY-MM-DD (2024.3.2 · 20240302도 됩니다)."});
        guide.add(new String[]{"상태", "선택 (비우면 정상). " + String.join(" / ", STATUS_ORDER.stream().map(WirelessDeviceService.STATUS_NAME::get).toList())});
        guide.add(new String[]{"유지보수 업체", "선택. ‘업체 목록’ 시트의 이름. 비우면 그 학교의 " + (s ? "스쿨넷" : "무선망") + " 담당 업체로 넣습니다." + (s ? "" : " 무선망 AS는 이 업체가 맡습니다.")});
        guide.add(new String[]{"비고", "선택. 500자 이내."});
        guide.add(new String[]{"행 수", "한 번에 최대 " + MAX_ROWS + "행. 예시 행은 지우고 올려 주세요."});

        List<List<String>> schoolRows = ss.stream().map(x -> {
            Region r = x.regionId == null ? null : rm.get(x.regionId);
            String v = schoolService.resolveVendor(x.schoolId, ty).map(sv -> vm.get(sv.vendorId)).map(vv -> vv.vendorName).orElse("(없음)");
            return List.of(x.schoolName, r == null ? "" : r.regionName, v);
        }).toList();
        List<List<String>> vendorRows = vendorsFor(me, ty).stream().map(v -> List.of(v.vendorName)).toList();
        return BulkSheet.template(s ? "스쿨넷 장비" : "무선장비", head, widths, samples, drop, text, guide,
                List.of(new BulkSheet.ListSheet("학교 목록", List.of("학교명", "교육지원청", (s ? "스쿨넷" : "무선망") + " 담당 업체"), schoolRows),
                        new BulkSheet.ListSheet("업체 목록", List.of("업체"), vendorRows)), MAX_ROWS);
    }

    // ---------- validate ----------

    @Transactional(readOnly = true)
    public Json validate(CurrentUser me, String ty, MultipartFile file) throws IOException {
        return BulkSheet.view(head(ty), check(me, ty, BulkSheet.read(file, head(ty), MAX_ROWS)));
    }

    private List<BulkSheet.Row> check(CurrentUser me, String ty, List<Map.Entry<Integer, List<String>>> rows) {
        List<String> head = head(ty);
        boolean s = "S".equals(ty);
        int cName = 1, cType = 2, cCode = 3, cModel = 4, cIp = head.indexOf("IP 주소"), cMac = head.indexOf("MAC 주소"), cLoc = head.indexOf("설치위치"),
                cInst = head.indexOf("설치일"), cChk = head.indexOf("최근 점검일"), cStatus = head.indexOf("상태"), cVendor = head.indexOf("유지보수 업체"), cNote = head.indexOf("비고");
        Map<String, List<School>> byName = new HashMap<>();
        for (School x : schoolService.schoolMap(me.orgId()).values()) byName.computeIfAbsent(AssetBulkService.norm(x.schoolName), k -> new ArrayList<>()).add(x);
        Set<Long> scope = schoolService.scopeSchoolIds(me);
        Map<String, List<Vendor>> vendorByName = new HashMap<>();
        for (Vendor v : schoolService.vendorMap(me.orgId()).values()) vendorByName.computeIfAbsent(AssetBulkService.norm(v.vendorName), k -> new ArrayList<>()).add(v);
        Map<String, String> typeAlias = new HashMap<>();
        types(ty).forEach((code, name) -> { typeAlias.put(AssetBulkService.norm(name), code); typeAlias.put(code.toLowerCase(), code); });
        if (!s) { typeAlias.put("ap", "AP"); typeAlias.put("스위치", "SWITCH"); typeAlias.put("poe", "SWITCH"); typeAlias.put("컨트롤러", "CONTROLLER"); }
        else { typeAlias.put("l3스위치", "L3"); typeAlias.put("l2스위치", "L2"); typeAlias.put("방화벽", "FIREWALL"); typeAlias.put("보안장비", "FIREWALL"); }
        Map<String, String> statusAlias = new HashMap<>();
        WirelessDeviceService.STATUS_NAME.forEach((code, name) -> { statusAlias.put(AssetBulkService.norm(name), code); statusAlias.put(code.toLowerCase(), code); });
        statusAlias.put("점검", "CHECK");
        Set<String> codes = new HashSet<>();
        for (String t : List.of("M", "S"))
            for (WirelessDevice d : devices.findByOrgIdAndRceptTyAndUseYnOrderBySchoolIdAscDeviceCodeAsc(me.orgId(), t, "Y"))
                if (d.deviceCode != null) codes.add(d.deviceCode.trim().toLowerCase());
        Map<String, Integer> codeRow = new HashMap<>();
        Map<Long, Optional<String>> schoolVendor = new HashMap<>();
        Map<Long, Vendor> allVendors = schoolService.allVendorMap(me.orgId());

        List<BulkSheet.Row> out = new ArrayList<>();
        for (Map.Entry<Integer, List<String>> e : rows) {
            int rowNo = e.getKey();
            List<String> c = new ArrayList<>(e.getValue());
            List<String> errors = new ArrayList<>(), warnings = new ArrayList<>();
            BulkSheet.formulaCheck(head, c, errors);
            Map<String, Object> b = new LinkedHashMap<>();

            String sn = c.get(0);
            School school = null;
            List<School> m = byName.getOrDefault(AssetBulkService.norm(sn), List.of());
            if (sn.isEmpty()) errors.add("학교명을 입력하세요.");
            else if (m.isEmpty()) errors.add("학교 '" + sn + "'을(를) 찾을 수 없습니다.");
            else if (m.size() > 1) errors.add("이름이 '" + sn + "'인 학교가 " + m.size() + "곳입니다. 학교 관리에서 이름을 구분해 주세요.");
            else if (scope != null && !scope.contains(m.get(0).schoolId)) errors.add("학교 '" + sn + "'은(는) 이 계정이 다룰 수 없는 학교입니다.");
            else { school = m.get(0); b.put("schoolId", school.schoolId); }

            String name = c.get(cName);
            if (name.isEmpty()) errors.add("장비명을 입력하세요.");
            BulkSheet.maxLen("장비명", name, 100, errors);
            b.put("deviceName", name);

            String type = c.get(cType);
            if (type.isEmpty()) { if (s) errors.add("장비 구분을 입력하세요. (" + String.join(" / ", typeNames(ty)) + ")"); else c.set(cType, types(ty).get("AP")); }
            else {
                String t = typeAlias.get(AssetBulkService.norm(type));
                if (t == null) errors.add("장비 구분 '" + type + "'은(는) 쓸 수 없습니다. (" + String.join(" / ", typeNames(ty)) + ")");
                else { b.put("deviceType", t); c.set(cType, types(ty).get(t)); }
            }

            String code = c.get(cCode);
            if (!code.isEmpty()) {
                BulkSheet.maxLen("장비번호", code, 30, errors);
                Integer prev = codeRow.putIfAbsent(code.toLowerCase(), rowNo);
                if (codes.contains(code.toLowerCase())) errors.add("장비번호 '" + code + "'은(는) 이미 다른 장비가 씁니다.");
                else if (prev != null) errors.add("장비번호가 " + prev + "행과 겹칩니다.");
                b.put("deviceCode", code);
            }
            BulkSheet.maxLen("모델명", c.get(cModel), 255, errors);
            b.put("modelName", BulkSheet.blankToNull(c.get(cModel)));
            if (s) {
                int cCar = head.indexOf("통신사"), cCir = head.indexOf("회선번호"), cBw = head.indexOf("회선 속도");
                BulkSheet.maxLen("통신사", c.get(cCar), 30, errors); BulkSheet.maxLen("회선번호", c.get(cCir), 50, errors); BulkSheet.maxLen("회선 속도", c.get(cBw), 30, errors);
                b.put("carrier", BulkSheet.blankToNull(c.get(cCar))); b.put("circuitId", BulkSheet.blankToNull(c.get(cCir))); b.put("bandwidth", BulkSheet.blankToNull(c.get(cBw)));
            }
            String ip = c.get(cIp);
            if (!ip.isEmpty() && !(IPV4.matcher(ip).matches() || (ip.contains(":") && IPV6.matcher(ip).matches()))) errors.add("IP 주소 형식이 올바르지 않습니다: " + ip);
            b.put("ipAddress", BulkSheet.blankToNull(ip));
            String mac = c.get(cMac);
            if (!mac.isEmpty()) {
                String hex = mac.replaceAll("[\\s:\\-.]", "");
                if (!hex.matches("[0-9A-Fa-f]{12}")) errors.add("MAC 주소 형식이 올바르지 않습니다: " + mac);
                else { mac = hex.toUpperCase().replaceAll("(..)(?!$)", "$1:"); c.set(cMac, mac); b.put("macAddress", mac); }
            }
            BulkSheet.maxLen("설치위치", c.get(cLoc), 255, errors);
            b.put("location", BulkSheet.blankToNull(c.get(cLoc)));
            for (int col : new int[]{cInst, cChk}) {
                String v = c.get(col);
                if (v.isEmpty()) continue;
                LocalDate d = AssetBulkService.parseDate(v);
                if (d == null) errors.add(head.get(col) + " 형식이 올바르지 않습니다 (YYYY-MM-DD): " + v);
                else if (d.isAfter(LocalDate.now().plusDays(1))) errors.add(head.get(col) + "이(가) 오늘 이후입니다: " + v);
                else { c.set(col, d.toString()); b.put(col == cInst ? "installedAt" : "lastCheckedAt", d.toString()); }
            }
            String st = c.get(cStatus);
            if (st.isEmpty()) c.set(cStatus, WirelessDeviceService.STATUS_NAME.get("NORMAL"));
            else {
                String code2 = statusAlias.get(AssetBulkService.norm(st));
                if (code2 == null) errors.add("상태 '" + st + "'은(는) 쓸 수 없습니다. (" + String.join(" / ", STATUS_ORDER.stream().map(WirelessDeviceService.STATUS_NAME::get).toList()) + ")");
                else { b.put("status", code2); c.set(cStatus, WirelessDeviceService.STATUS_NAME.get(code2)); }
            }
            String vn = c.get(cVendor);
            if (!vn.isEmpty()) {
                List<Vendor> vs = vendorByName.getOrDefault(AssetBulkService.norm(vn), List.of());
                if (vs.isEmpty()) errors.add("업체 '" + vn + "'을(를) 찾을 수 없습니다.");
                else if (vs.size() > 1) errors.add("이름이 '" + vn + "'인 업체가 " + vs.size() + "곳입니다.");
                else if (!vs.get(0).serviceTypeList().contains(ty)) errors.add(vn + "은(는) " + noun(ty) + " 유지관리 업체가 아닙니다.");
                else b.put("vendorId", vs.get(0).vendorId);
            } else if (school != null) {
                Long sid = school.schoolId;
                Optional<String> sv = schoolVendor.computeIfAbsent(sid, k -> schoolService.resolveVendor(k, ty).map(x -> allVendors.get(x.vendorId)).map(v -> v.vendorName));
                if (sv.isPresent()) c.set(cVendor, sv.get() + " (학교 담당)");
                else warnings.add("유지보수 업체가 없습니다 — 학교의 " + (s ? "스쿨넷" : "무선망") + " 담당 업체가 지정되어 있지 않습니다.");
            }
            BulkSheet.maxLen("비고", c.get(cNote), 500, errors);
            b.put("note", BulkSheet.blankToNull(c.get(cNote)));
            out.add(new BulkSheet.Row(rowNo, c, errors, warnings, b));
        }
        return out;
    }

    // ---------- commit ----------

    public Json commit(CurrentUser me, String ty, MultipartFile file, boolean skipErrors) throws IOException {
        List<BulkSheet.Row> rows = check(me, ty, BulkSheet.read(file, head(ty), MAX_ROWS));
        long skipped = BulkSheet.requireCommittable(rows, skipErrors);
        List<Json> created = new ArrayList<>();
        for (BulkSheet.Row r : rows) {
            if (!r.ok()) continue;
            WirelessDevice d;
            try { d = deviceService.newDevice(me, ty, r.payload()); }
            catch (ApiException e) { throw ApiException.badRequest(r.rowNo() + "행: " + e.getMessage() + " (아무것도 등록하지 않았습니다)"); }
            created.add(Json.obj().with("rowNo", r.rowNo()).with("id", d.deviceId).with("name", d.deviceCode + " · " + d.deviceName).with("sub", r.cells().get(0)));
        }
        return Json.obj().with("created", (long) created.size()).with("skipped", skipped).with("items", created);
    }
}
