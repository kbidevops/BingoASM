package com.bingoasm.service.as;

import com.bingoasm.common.ApiException;
import com.bingoasm.common.Json;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.*;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.util.CellRangeAddressList;
import org.apache.poi.xssf.usermodel.*;
import org.springframework.web.multipart.MultipartFile;

/**
 * 엑셀 일괄 등록의 공통 부분 (학교 · 무선망 장비 · 스쿨넷 장비): 양식 만들기, 파일 읽기 · 제목 행 확인, 검사 결과 응답.
 * 흐름은 자산 · 사용자 일괄 등록과 같다: 양식 → 검증(행별 오류) → 확정(오류 없는 행만, 한 트랜잭션).
 */
public final class BulkSheet {
    private BulkSheet() { }

    /** 한 행의 검사 결과. payload = 등록할 때 쓰는 값 (오류가 있으면 쓰지 않는다). */
    public record Row(int rowNo, List<String> cells, List<String> errors, List<String> warnings, Map<String, Object> payload) {
        public boolean ok() { return errors.isEmpty(); }
    }

    /** 목록 시트: 양식에 함께 넣는 참고 목록 (학교 · 업체 · 교육지원청 이름 등). */
    public record ListSheet(String name, List<String> head, List<List<String>> rows) {}

    // ---------- 읽기 ----------

    /** xlsx만, 제목 행이 양식과 같아야 한다. 빈 행은 뺀다. 결과는 (엑셀 행 번호, 칸) — 칸은 앞뒤 공백을 지운 값. */
    public static List<Map.Entry<Integer, List<String>>> read(MultipartFile file, List<String> head, int maxRows) throws IOException {
        if (file == null || file.isEmpty()) throw ApiException.badRequest("엑셀 파일(.xlsx)을 선택해 주세요.");
        String name = Optional.ofNullable(file.getOriginalFilename()).orElse("");
        if (!name.toLowerCase().endsWith(".xlsx")) throw ApiException.badRequest("xlsx 형식만 올릴 수 있습니다.");
        List<List<String>> rows = AssetBulkService.readRows(file.getInputStream(), head.size(), maxRows);
        if (rows.isEmpty()) throw ApiException.badRequest("빈 파일입니다. 양식을 내려받아 작성해 주세요.");
        List<String> h = rows.get(0).stream().map(s -> s == null ? "" : s.trim()).toList();
        for (int i = 0; i < head.size(); i++)
            if (i >= h.size() || !head.get(i).equals(h.get(i)))
                throw ApiException.badRequest("양식이 다릅니다. " + (i + 1) + "번째 열은 '" + head.get(i) + "'이어야 합니다. 양식을 다시 내려받아 주세요.");
        List<Map.Entry<Integer, List<String>>> out = new ArrayList<>();
        for (int i = 1; i < rows.size(); i++) {
            List<String> r = rows.get(i);
            if (r.stream().noneMatch(c -> c != null && !c.isBlank())) continue;
            List<String> cells = new ArrayList<>();
            for (int c = 0; c < head.size(); c++) cells.add(c < r.size() && r.get(c) != null ? r.get(c).trim() : "");
            out.add(Map.entry(i + 1, cells));
        }
        if (out.isEmpty()) throw ApiException.badRequest("등록할 행이 없습니다.");
        if (out.size() > maxRows) throw ApiException.badRequest("한 번에 최대 " + maxRows + "행까지 올릴 수 있습니다. (" + out.size() + "행)");
        return out;
    }

    /** =, +, -, @로 시작하는 칸(수식 주입)은 오류. */
    public static void formulaCheck(List<String> head, List<String> cells, List<String> errors) {
        for (int c = 0; c < cells.size(); c++)
            if (AssetBulkService.looksLikeFormula(cells.get(c))) errors.add(head.get(c) + ": =, +, -, @로 시작할 수 없습니다.");
    }

    public static void maxLen(String label, String v, int max, List<String> errors) {
        if (v != null && v.length() > max) errors.add(label + "은(는) " + max + "자 이내여야 합니다.");
    }

    public static String blankToNull(String s) { return s == null || s.isBlank() ? null : s; }

    // ---------- 응답 ----------

    public static Json view(List<String> head, List<Row> rows) {
        long ok = rows.stream().filter(Row::ok).count();
        List<Json> rj = rows.stream().map(x -> Json.obj().with("rowNo", x.rowNo()).with("cells", x.cells()).with("errors", x.errors())
                .with("ok", x.ok()).with("warning", x.warnings().isEmpty() ? null : String.join(" ", x.warnings()))).toList();
        return Json.obj().with("head", head).with("total", (long) rows.size()).with("ok", ok).with("error", rows.size() - ok).with("rows", rj);
    }

    /** 확정 전 확인: 오류 행이 있으면 skipErrors일 때만 빼고 등록, 등록할 행이 없으면 400. 오류 행 수를 돌려준다. */
    public static long requireCommittable(List<Row> rows, boolean skipErrors) {
        long errors = rows.stream().filter(r -> !r.ok()).count();
        if (errors > 0 && !skipErrors) throw ApiException.badRequest("오류가 있는 행이 " + errors + "개 있습니다. 고친 뒤 다시 올리거나 오류 행을 빼고 등록하세요.");
        if (errors == rows.size()) throw ApiException.badRequest("등록할 수 있는 행이 없습니다.");
        return errors;
    }

    // ---------- 양식 ----------

    /**
     * 양식 만들기: 첫 시트(제목 행 · 예시 행 · 고르는 칸의 목록), 안내 시트, 참고 목록 시트.
     * @param dropdowns 열 번호 → 고를 수 있는 값 (짧은 목록만: 엑셀 제한 255자)
     * @param textCols  글자로 둘 열 (앞의 0이 빠지지 않게: 전화 · 번호 등)
     */
    public static byte[] template(String sheetName, List<String> head, int[] widths, List<List<String>> samples, Map<Integer, List<String>> dropdowns,
                                  Set<Integer> textCols, List<String[]> guide, List<ListSheet> lists, int maxRows) throws IOException {
        try (XSSFWorkbook wb = new XSSFWorkbook()) {
            XSSFSheet sh = wb.createSheet(sheetName);
            CellStyle hs = wb.createCellStyle();
            Font bold = wb.createFont(); bold.setBold(true); hs.setFont(bold);
            hs.setFillForegroundColor(IndexedColors.GREY_25_PERCENT.getIndex()); hs.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            hs.setBorderBottom(BorderStyle.THIN);
            CellStyle text = wb.createCellStyle();
            text.setDataFormat(wb.createDataFormat().getFormat("@"));
            org.apache.poi.ss.usermodel.Row h = sh.createRow(0);
            for (int i = 0; i < head.size(); i++) { Cell c = h.createCell(i); c.setCellValue(head.get(i)); c.setCellStyle(hs); }
            for (int r = 0; r < samples.size(); r++) {
                org.apache.poi.ss.usermodel.Row row = sh.createRow(r + 1);
                for (int c = 0; c < samples.get(r).size(); c++) {
                    Cell cell = row.createCell(c); cell.setCellValue(samples.get(r).get(c));
                    if (textCols.contains(c)) cell.setCellStyle(text);
                }
            }
            for (int i = 0; i < head.size(); i++) sh.setColumnWidth(i, (i < widths.length ? widths[i] : 16) * 256);
            for (int c : textCols) sh.setDefaultColumnStyle(c, text);
            sh.createFreezePane(0, 1);
            XSSFDataValidationHelper dv = new XSSFDataValidationHelper(sh);
            dropdowns.forEach((col, values) -> {
                if (values.isEmpty() || String.join(",", values).length() > 250) return;
                DataValidation v = dv.createValidation(dv.createExplicitListConstraint(values.toArray(String[]::new)), new CellRangeAddressList(1, maxRows, col, col));
                v.setShowErrorBox(false); v.setSuppressDropDownArrow(true);
                sh.addValidationData(v);
            });

            XSSFSheet gs = wb.createSheet("안내");
            List<String[]> g = new ArrayList<>();
            g.add(new String[]{"열", "입력 규칙"});
            g.addAll(guide);
            for (int r = 0; r < g.size(); r++) {
                org.apache.poi.ss.usermodel.Row row = gs.createRow(r);
                for (int c = 0; c < g.get(r).length; c++) { Cell cell = row.createCell(c); cell.setCellValue(g.get(r)[c]); if (r == 0) cell.setCellStyle(hs); }
            }
            gs.setColumnWidth(0, 18 * 256); gs.setColumnWidth(1, 100 * 256);

            for (ListSheet l : lists) {
                XSSFSheet ls = wb.createSheet(l.name());
                org.apache.poi.ss.usermodel.Row lh = ls.createRow(0);
                for (int i = 0; i < l.head().size(); i++) { Cell c = lh.createCell(i); c.setCellValue(l.head().get(i)); c.setCellStyle(hs); ls.setColumnWidth(i, 26 * 256); }
                for (int r = 0; r < l.rows().size(); r++) {
                    org.apache.poi.ss.usermodel.Row row = ls.createRow(r + 1);
                    for (int c = 0; c < l.rows().get(r).size(); c++) row.createCell(c).setCellValue(Objects.toString(l.rows().get(r).get(c), ""));
                }
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            wb.write(out);
            return out.toByteArray();
        }
    }
}
