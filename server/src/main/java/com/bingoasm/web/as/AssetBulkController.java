package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.common.Times;
import com.bingoasm.service.as.AssetBulkService;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** 자산 일괄 등록: 양식 → 검증 → 확정. 파일(multipart) 또는 파싱한 행(JSON) 둘 다 받는다. */
@Tag(name = "자산 일괄 등록", description = "엑셀 양식 → 검증 → 확정")
@RestController
@RequestMapping("/api/assets/bulk")
@RequirePerm("ASSET_BULK")
public class AssetBulkController {
    private final AssetBulkService bulk;

    public AssetBulkController(AssetBulkService bulk) { this.bulk = bulk; }

    @GetMapping("/template")
    public void template(HttpServletResponse res) throws IOException {
        byte[] bytes = bulk.template(AuthContext.get());
        String name = URLEncoder.encode("자산일괄등록_양식_" + Times.today() + ".xlsx", StandardCharsets.UTF_8).replace("+", "%20");
        res.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + name);
        res.setContentLength(bytes.length);
        res.getOutputStream().write(bytes);
        res.flushBuffer();
    }

    @PostMapping(value = "/validate", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse validateFile(@RequestParam("file") MultipartFile file) throws IOException {
        return ApiResponse.ok(bulk.validate(AuthContext.get(), file));
    }

    /** body: { rows: [[헤더...],[행...],...] } (SheetJS 등으로 브라우저에서 파싱한 경우) */
    @PostMapping(value = "/validate", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ApiResponse validateRows(@RequestBody Map<String, Object> body) {
        return ApiResponse.ok(bulk.validateRows(AuthContext.get(), rows(body)));
    }

    @PostMapping(value = "/commit", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse commitFile(@RequestParam("file") MultipartFile file, @RequestParam(required = false) Boolean skipErrors) throws IOException {
        return ApiResponse.ok(bulk.commit(AuthContext.get(), file, Boolean.TRUE.equals(skipErrors)));
    }

    /** body: { rows: [[...]], skipErrors?: boolean } */
    @PostMapping(value = "/commit", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ApiResponse commitRows(@RequestBody Map<String, Object> body) {
        return ApiResponse.ok(bulk.commit(AuthContext.get(), rows(body), Boolean.TRUE.equals(body.get("skipErrors"))));
    }

    @SuppressWarnings("unchecked")
    private static List<List<String>> rows(Map<String, Object> body) {
        Object r = body.get("rows");
        if (!(r instanceof List<?> l)) return List.of();
        return l.stream().map(row -> row instanceof List<?> cells
                ? cells.stream().map(c -> c == null ? "" : String.valueOf(c)).toList() : List.<String>of()).toList();
    }
}
