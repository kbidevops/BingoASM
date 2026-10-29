package com.bingoasm.service;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;

/** Writes simple tabular sheets as an .xlsx download with a UTF-8 file name. */
public final class ExcelWriter implements AutoCloseable {
    /** Column: header label and the row map key. */
    public record Col(String header, String key, int width) {
        public static Col of(String header, String key) { return new Col(header, key, 16); }
        public static Col of(String header, String key, int width) { return new Col(header, key, width); }
    }

    private final SXSSFWorkbook wb = new SXSSFWorkbook(200);
    private final CellStyle headerStyle;

    public ExcelWriter() {
        headerStyle = wb.createCellStyle();
        Font f = wb.createFont();
        f.setBold(true);
        headerStyle.setFont(f);
    }

    public ExcelWriter sheet(String name, List<Col> cols, List<? extends Map<String, Object>> rows) {
        Sheet sh = wb.createSheet(name);
        Row header = sh.createRow(0);
        for (int i = 0; i < cols.size(); i++) {
            Cell c = header.createCell(i);
            c.setCellValue(cols.get(i).header());
            c.setCellStyle(headerStyle);
            sh.setColumnWidth(i, cols.get(i).width() * 256);
        }
        int r = 1;
        for (Map<String, Object> row : rows) {
            Row xr = sh.createRow(r++);
            for (int i = 0; i < cols.size(); i++) {
                Object v = row.get(cols.get(i).key());
                if (v == null) continue;
                Cell c = xr.createCell(i);
                if (v instanceof Number n) c.setCellValue(n.doubleValue());
                else c.setCellValue(String.valueOf(v).replace('T', ' '));
            }
        }
        return this;
    }

    public void write(HttpServletResponse res, String filename) throws IOException {
        res.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20"));
        wb.write(res.getOutputStream());
        res.flushBuffer();
    }

    @Override
    public void close() throws IOException {
        wb.close();
    }
}
