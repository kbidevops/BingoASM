package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.Category;
import com.bingoasm.domain.as.Room;
import com.bingoasm.domain.as.School;
import com.bingoasm.repo.CategoryRepository;
import com.bingoasm.repo.as.RoomRepository;
import com.bingoasm.service.AssetService;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.*;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.util.CellRangeAddressList;
import org.apache.poi.xssf.usermodel.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 자산 일괄 등록(엑셀). 동료 UI의 BK_HEAD 열 순서를 그대로 쓴다:
 * 기관명 · 분류 · 품명·규격 · 취득일(YYYY-MM-DD) · 내용연수(년) · 위치 · 상태
 * 흐름: 양식 다운로드 → 업로드 검증(오류 행 표시) → 확정 등록.
 */
@Service
@Transactional
public class AssetBulkService {
    public static final List<String> HEAD = List.of("기관명", "분류", "품명·규격", "취득일(YYYY-MM-DD)", "내용연수(년)", "위치", "상태");
    public static final int MAX_ROWS = 2000;
    static final Map<String, String> STATUS_BY_NAME = Map.of("사용", "INUSE", "사용중", "INUSE", "유휴", "IDLE", "수리", "REPAIR", "불용예정", "DISPOSE_PLANNED", "불용", "DISPOSED");
    static final Map<String, String> STATUS_NAME = Map.of("INUSE", "사용", "IDLE", "유휴", "REPAIR", "수리", "DISPOSE_PLANNED", "불용예정", "DISPOSED", "불용");

    private final CategoryRepository categories;
    private final RoomRepository rooms;
    private final SchoolService schoolService;
    private final AssetService assetService;
    private final SpaceService spaceService;

    public AssetBulkService(CategoryRepository categories, RoomRepository rooms, SchoolService schoolService, AssetService assetService, SpaceService spaceService) {
        this.categories = categories; this.rooms = rooms; this.schoolService = schoolService; this.assetService = assetService; this.spaceService = spaceService;
    }

    private List<Category> hwCategories() {
        return categories.findByUseYnOrderBySortOrderAsc("Y").stream().filter(c -> "HW".equals(c.assetType)).toList();
    }

    /** 학교 담당자는 자기 학교만, 교육지원청 담당자는 관내 학교만, 도교육청 관리자는 전체 학교. */
    private List<School> allowedSchools(CurrentUser me) {
        List<School> all = new ArrayList<>(schoolService.schoolMap(me.orgId()).values());
        all.sort(Comparator.comparing(s -> s.schoolName));
        Set<Long> inScope = schoolService.scopeSchoolIds(me);
        return inScope == null ? all : all.stream().filter(s -> inScope.contains(s.schoolId)).toList();
    }

    // ---------- template ----------

    /** 양식: 자산 시트(헤더+예시 2행+드롭다운) · 안내 시트 · 실 목록 시트. */
    @Transactional(readOnly = true)
    public byte[] template(CurrentUser me) throws IOException {
        List<School> schools = allowedSchools(me);
        List<Category> cats = hwCategories();
        List<String> statusNames = List.of("사용", "유휴", "수리", "불용예정", "불용");
        try (XSSFWorkbook wb = new XSSFWorkbook()) {
            XSSFSheet sh = wb.createSheet("자산");
            CellStyle head = wb.createCellStyle();
            Font bold = wb.createFont(); bold.setBold(true); head.setFont(bold);
            head.setFillForegroundColor(IndexedColors.GREY_25_PERCENT.getIndex()); head.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            head.setBorderBottom(BorderStyle.THIN);
            Row h = sh.createRow(0);
            for (int i = 0; i < HEAD.size(); i++) { Cell c = h.createCell(i); c.setCellValue(HEAD.get(i)); c.setCellStyle(head); }
            String school0 = schools.isEmpty() ? "봉황초등학교" : schools.get(0).schoolName;
            String cat0 = cats.isEmpty() ? "데스크톱" : cats.get(0).categoryName;
            String cat1 = cats.size() > 1 ? cats.get(1).categoryName : cat0;
            List<Room> rs = schools.isEmpty() ? List.of() : rooms.findBySchoolIdAndUseYnOrderByBuildingIdAscFloorIdAscRoomNoAsc(schools.get(0).schoolId, "Y");
            String room0 = rs.isEmpty() ? "1-1 교실" : rs.get(0).roomName;
            String room1 = rs.size() > 1 ? rs.get(1).roomName : room0;
            String[][] sample = {
                    {school0, cat0, "교사용 데스크톱 i5/16GB/512GB", Times.today().minusMonths(3).toString(), "5", room0, "사용"},
                    {school0, cat1, "학생용 노트북 14형", Times.today().minusYears(6).toString(), "5", room1, "불용예정"}};
            for (int r = 0; r < sample.length; r++) {
                Row row = sh.createRow(r + 1);
                for (int c = 0; c < sample[r].length; c++) row.createCell(c).setCellValue(sample[r][c]);
            }
            int[] widths = {22, 16, 34, 20, 12, 22, 10};
            for (int i = 0; i < widths.length; i++) sh.setColumnWidth(i, widths[i] * 256);
            sh.createFreezePane(0, 1);

            // 드롭다운: 기관명(허용 학교) · 분류 · 상태
            XSSFDataValidationHelper dv = new XSSFDataValidationHelper(sh);
            if (!schools.isEmpty() && schools.size() <= 100) addList(sh, dv, 0, schools.stream().map(s -> s.schoolName).toList());
            if (!cats.isEmpty()) addList(sh, dv, 1, cats.stream().map(c -> c.categoryName).toList());
            addList(sh, dv, 6, statusNames);

            XSSFSheet guide = wb.createSheet("안내");
            String[][] g = {
                    {"열", "입력 규칙"},
                    {"기관명", "소속 기관(학교) 이름. 학교 담당자는 본인 학교만 등록할 수 있습니다."},
                    {"분류", "자산 분류명: " + String.join(", ", cats.stream().map(c -> c.categoryName).toList())},
                    {"품명·규격", "자산명과 규격. 60자 이내."},
                    {"취득일(YYYY-MM-DD)", "예: 2024-03-11. 오늘 이후 날짜는 등록할 수 없습니다."},
                    {"내용연수(년)", "1~15 사이 정수. 비우면 분류의 기본 내용연수를 적용합니다."},
                    {"위치", "실 이름(실 목록 시트 참고). 없으면 위치 미지정으로 등록됩니다."},
                    {"상태", String.join(" / ", statusNames) + " (비우면 사용)"},
                    {"행 수", "한 번에 최대 " + MAX_ROWS + "행. 예시 2행은 지우고 올려 주세요."},
                    {"자산번호", "자동 부여됩니다: 기관접두어-취득연도-일련번호 (예: CB-2024-00012)"}};
            for (int r = 0; r < g.length; r++) { Row row = guide.createRow(r); for (int c = 0; c < g[r].length; c++) { Cell cell = row.createCell(c); cell.setCellValue(g[r][c]); if (r == 0) cell.setCellStyle(head); } }
            guide.setColumnWidth(0, 22 * 256); guide.setColumnWidth(1, 80 * 256);

            XSSFSheet rl = wb.createSheet("실 목록");
            Row rh = rl.createRow(0);
            String[] rhead = {"기관명", "건물", "층", "실번호", "실 이름"};
            for (int i = 0; i < rhead.length; i++) { Cell c = rh.createCell(i); c.setCellValue(rhead[i]); c.setCellStyle(head); }
            int ri = 1;
            for (School s : schools) {
                for (Json r : roomsOf(me, s.schoolId)) {
                    Row row = rl.createRow(ri++);
                    row.createCell(0).setCellValue(s.schoolName);
                    row.createCell(1).setCellValue(String.valueOf(Optional.ofNullable(r.get("buildingName")).orElse("")));
                    row.createCell(2).setCellValue(String.valueOf(Optional.ofNullable(r.get("floorName")).orElse("")));
                    row.createCell(3).setCellValue(String.valueOf(Optional.ofNullable(r.get("roomNo")).orElse("")));
                    row.createCell(4).setCellValue(String.valueOf(Optional.ofNullable(r.get("roomName")).orElse("")));
                }
            }
            int[] rw = {22, 14, 10, 10, 22};
            for (int i = 0; i < rw.length; i++) rl.setColumnWidth(i, rw[i] * 256);

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            wb.write(out);
            return out.toByteArray();
        }
    }

    /** 실 목록 시트용. 건물·층 이름이 붙은 SpaceService.rooms()를 쓴다. */
    private List<Json> roomsOf(CurrentUser me, Long schoolId) {
        try { return spaceService.rooms(me, schoolId, null); } catch (ApiException e) { return List.of(); }
    }

    private static void addList(XSSFSheet sh, XSSFDataValidationHelper dv, int col, List<String> values) {
        String joined = String.join(",", values);
        if (joined.length() > 250) return; // 엑셀 제한: 인라인 목록 255자
        DataValidationConstraint c = dv.createExplicitListConstraint(values.toArray(String[]::new));
        DataValidation v = dv.createValidation(c, new CellRangeAddressList(1, MAX_ROWS, col, col));
        v.setShowErrorBox(false); v.setSuppressDropDownArrow(true);
        sh.addValidationData(v);
    }

    // ---------- validate ----------

    public record RowResult(int rowNo, List<String> cells, List<String> errors, Map<String, Object> asset) {}

    /** 업로드 파일을 읽어 행별 검증 결과를 돌려준다. 등록은 하지 않는다. */
    @Transactional(readOnly = true)
    public Json validate(CurrentUser me, MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) throw ApiException.badRequest("엑셀 파일(.xlsx)을 선택해 주세요.");
        String name = Optional.ofNullable(file.getOriginalFilename()).orElse("");
        if (!name.toLowerCase().endsWith(".xlsx")) throw ApiException.badRequest("xlsx 형식만 올릴 수 있습니다.");
        List<List<String>> rows = readRows(file.getInputStream());
        return validateRows(me, rows);
    }

    /** JSON 배열([[...],[...]] 헤더 포함)로 보내는 경우도 받는다(동료 UI는 SheetJS로 파싱해 보낸다). */
    @Transactional(readOnly = true)
    public Json validateRows(CurrentUser me, List<List<String>> rows) {
        if (rows.isEmpty()) throw ApiException.badRequest("빈 파일입니다. 양식을 내려받아 작성해 주세요.");
        List<String> head = rows.get(0).stream().map(s -> s == null ? "" : s.trim()).toList();
        for (int i = 0; i < HEAD.size(); i++) {
            if (i >= head.size() || !HEAD.get(i).equals(head.get(i)))
                throw ApiException.badRequest("양식이 다릅니다. " + (i + 1) + "번째 열은 '" + HEAD.get(i) + "'이어야 합니다. 양식을 다시 내려받아 주세요.");
        }
        List<List<String>> body = rows.subList(1, rows.size()).stream().filter(r -> r.stream().anyMatch(c -> c != null && !c.isBlank())).toList();
        if (body.isEmpty()) throw ApiException.badRequest("등록할 행이 없습니다.");
        if (body.size() > MAX_ROWS) throw ApiException.badRequest("한 번에 최대 " + MAX_ROWS + "행까지 올릴 수 있습니다. (" + body.size() + "행)");

        Map<String, School> schoolByName = new HashMap<>();
        for (School s : allowedSchools(me)) schoolByName.put(norm(s.schoolName), s);
        Map<String, Category> catByName = new HashMap<>();
        for (Category c : hwCategories()) catByName.put(norm(c.categoryName), c);
        Map<Long, Map<String, Room>> roomsBySchool = new HashMap<>();

        List<RowResult> results = new ArrayList<>();
        int ok = 0;
        for (int i = 0; i < body.size(); i++) {
            List<String> r = body.get(i);
            List<String> cells = new ArrayList<>();
            for (int c = 0; c < HEAD.size(); c++) cells.add(c < r.size() && r.get(c) != null ? r.get(c).trim() : "");
            List<String> errors = new ArrayList<>();
            Map<String, Object> a = new LinkedHashMap<>();
            for (int c = 0; c < cells.size(); c++) if (looksLikeFormula(cells.get(c))) errors.add(HEAD.get(c) + ": 수식(=, +, -, @로 시작)은 입력할 수 없습니다.");

            School school = schoolByName.get(norm(cells.get(0)));
            if (cells.get(0).isEmpty()) errors.add("기관명을 입력하세요.");
            else if (school == null) errors.add("기관명 '" + cells.get(0) + "'을(를) 찾을 수 없거나 등록 권한이 없습니다.");
            else a.put("schoolId", school.schoolId);

            Category cat = catByName.get(norm(cells.get(1)));
            if (cells.get(1).isEmpty()) errors.add("분류를 입력하세요.");
            else if (cat == null) errors.add("분류 '" + cells.get(1) + "'은(는) 없는 분류입니다.");
            else a.put("categoryId", cat.categoryId);

            String nm = cells.get(2);
            if (nm.isEmpty()) errors.add("품명·규격을 입력하세요.");
            else if (nm.length() > 60) errors.add("품명·규격은 60자 이내여야 합니다. (" + nm.length() + "자)");
            else a.put("assetName", nm);

            String ds = cells.get(3);
            if (ds.isEmpty()) errors.add("취득일을 입력하세요.");
            else {
                LocalDate d = parseDate(ds);
                if (d == null) errors.add("취득일 형식이 올바르지 않습니다: " + ds + " (YYYY-MM-DD)");
                else if (d.isAfter(Times.today())) errors.add("취득일이 오늘 이후입니다: " + ds);
                else a.put("acquiredAt", d.toString());
            }

            String ly = cells.get(4);
            if (ly.isEmpty()) { if (cat != null && cat.lifeYears != null) a.put("lifeYears", cat.lifeYears); }
            else {
                Integer n = parseInt(ly);
                if (n == null || n < 1 || n > 15) errors.add("내용연수는 1~15 사이 정수여야 합니다: " + ly);
                else a.put("lifeYears", n);
            }

            String loc = cells.get(5);
            if (!loc.isEmpty()) {
                if (school != null) {
                    Map<String, Room> rm = roomsBySchool.computeIfAbsent(school.schoolId, k -> {
                        Map<String, Room> m = new HashMap<>();
                        for (Room x : rooms.findBySchoolIdAndUseYnOrderByBuildingIdAscFloorIdAscRoomNoAsc(k, "Y")) { m.put(norm(x.roomName), x); if (x.roomNo != null) m.put(norm(x.roomNo), x); }
                        return m;
                    });
                    Room room = rm.get(norm(loc));
                    if (room == null) { a.put("locationDetail", loc); a.put("locationWarning", "실 '" + loc + "'이(가) 없어 위치 미지정(비고에 기록)으로 등록됩니다."); }
                    else { a.put("roomId", room.roomId); a.put("buildingId", room.buildingId); a.put("floorId", room.floorId); a.put("locationDetail", room.roomName); }
                }
            }

            String st = cells.get(6);
            if (st.isEmpty()) a.put("status", "INUSE");
            else if (!STATUS_BY_NAME.containsKey(st)) errors.add("상태는 사용/유휴/수리/불용예정/불용 중 하나여야 합니다: " + st);
            else a.put("status", STATUS_BY_NAME.get(st));

            if (errors.isEmpty()) ok++;
            results.add(new RowResult(i + 2, cells, errors, a));
        }
        List<Json> rowsJson = results.stream().map(x -> Json.obj().with("rowNo", x.rowNo()).with("cells", x.cells()).with("errors", x.errors())
                .with("ok", x.errors().isEmpty()).with("warning", x.asset().get("locationWarning")).with("asset", x.errors().isEmpty() ? x.asset() : null)).toList();
        return Json.obj().with("head", HEAD).with("total", results.size()).with("ok", ok).with("error", results.size() - ok).with("rows", rowsJson);
    }

    // ---------- commit ----------

    /** 검증을 다시 수행한 뒤 오류가 없는 행만(또는 전체 오류 없을 때만) 등록. body: { rows:[[...]], skipErrors:boolean } */
    public Json commit(CurrentUser me, List<List<String>> rows, boolean skipErrors) {
        Json v = validateRows(me, rows);
        @SuppressWarnings("unchecked") List<Json> rs = (List<Json>) v.get("rows");
        long errors = (long) (int) v.get("error");
        if (errors > 0 && !skipErrors) throw ApiException.badRequest("오류가 있는 행이 " + errors + "개 있습니다. 수정 후 다시 올리거나 '오류 행 제외' 옵션을 사용하세요.");
        List<Json> created = new ArrayList<>();
        for (Json r : rs) {
            if (!Boolean.TRUE.equals(r.get("ok"))) continue;
            @SuppressWarnings("unchecked") Map<String, Object> a = new LinkedHashMap<>((Map<String, Object>) r.get("asset"));
            a.remove("locationWarning");
            a.put("assetType", "HW");
            a.put("note", "일괄 등록 " + Times.today());
            Long id = assetService.create(me, a);
            Json d = assetService.detail(me, id);
            created.add(Json.obj().with("rowNo", r.get("rowNo")).with("assetId", id).with("assetNo", d.get("assetNo")).with("assetName", d.get("assetName")));
        }
        return Json.obj().with("created", (long) created.size()).with("skipped", errors).with("assets", created);
    }

    public Json commit(CurrentUser me, MultipartFile file, boolean skipErrors) throws IOException {
        if (file == null || file.isEmpty()) throw ApiException.badRequest("엑셀 파일(.xlsx)을 선택해 주세요.");
        return commit(me, readRows(file.getInputStream()), skipErrors);
    }

    // ---------- helpers ----------

    static List<List<String>> readRows(InputStream in) throws IOException {
        try (Workbook wb = WorkbookFactory.create(in)) {
            Sheet sh = wb.getNumberOfSheets() > 0 ? wb.getSheetAt(0) : null;
            if (sh == null) return List.of();
            DataFormatter fmt = new DataFormatter();
            List<List<String>> out = new ArrayList<>();
            int last = Math.min(sh.getLastRowNum(), MAX_ROWS + 50);
            for (int i = 0; i <= last; i++) {
                Row row = sh.getRow(i);
                List<String> cells = new ArrayList<>();
                if (row != null) for (int c = 0; c < HEAD.size(); c++) {
                    Cell cell = row.getCell(c);
                    if (cell == null) { cells.add(""); continue; }
                    if (cell.getCellType() == CellType.NUMERIC && DateUtil.isCellDateFormatted(cell)) cells.add(cell.getLocalDateTimeCellValue().toLocalDate().toString());
                    else if (cell.getCellType() == CellType.FORMULA) cells.add("=" + cell.getCellFormula());
                    else cells.add(fmt.formatCellValue(cell));
                }
                out.add(cells);
            }
            return out;
        } catch (ApiException e) { throw e; }
        catch (Exception e) { throw ApiException.badRequest("엑셀 파일을 읽을 수 없습니다. 양식(.xlsx)을 확인해 주세요."); }
    }

    static boolean looksLikeFormula(String s) {
        if (s == null || s.isEmpty()) return false;
        char c = s.charAt(0);
        return c == '=' || c == '+' || c == '@' || (c == '-' && s.length() > 1 && !Character.isDigit(s.charAt(1)));
    }

    static String norm(String s) { return s == null ? "" : s.replaceAll("\\s+", "").toLowerCase(); }

    static LocalDate parseDate(String s) {
        String t = s.trim().replace('.', '-').replace('/', '-');
        if (t.matches("\\d{8}")) t = t.substring(0, 4) + "-" + t.substring(4, 6) + "-" + t.substring(6);
        if (t.matches("\\d{4}-\\d{1,2}-\\d{1,2}")) {
            String[] p = t.split("-");
            t = p[0] + "-" + (p[1].length() == 1 ? "0" : "") + p[1] + "-" + (p[2].length() == 1 ? "0" : "") + p[2];
        }
        try { return LocalDate.parse(t.length() > 10 ? t.substring(0, 10) : t); } catch (DateTimeParseException e) { return null; }
    }

    static Integer parseInt(String s) {
        try { return (int) Double.parseDouble(s.trim().replace("년", "")); } catch (Exception e) { return null; }
    }
}
