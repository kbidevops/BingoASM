package com.bingoasm.web.as;

import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.common.Times;
import com.bingoasm.service.as.DeviceBulkService;
import com.bingoasm.service.as.SchoolBulkService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/**
 * 학교 · 무선망 장비 · 스쿨넷 장비 엑셀 일괄 등록: GET …/bulk/template → POST …/bulk/validate → POST …/bulk/commit (multipart file, skipErrors).
 * 권한은 각 화면의 등록 기능과 같다 (SCHOOL_CREATE · WDEVICE_CREATE · SDEVICE_CREATE).
 */
@Tag(name = "기준정보 · 일괄 등록", description = "학교 · 무선망 장비 · 스쿨넷 장비 엑셀 일괄 등록 (양식 → 검증 → 확정)")
@RestController
@RequestMapping("/api/as")
public class BulkRegisterController {
    private static final String XLSX = MediaType.MULTIPART_FORM_DATA_VALUE;
    private final SchoolBulkService schoolBulk;
    private final DeviceBulkService deviceBulk;

    public BulkRegisterController(SchoolBulkService schoolBulk, DeviceBulkService deviceBulk) { this.schoolBulk = schoolBulk; this.deviceBulk = deviceBulk; }

    private static void send(HttpServletResponse res, String base, byte[] bytes) throws IOException {
        String name = URLEncoder.encode(base + "_양식_" + Times.today() + ".xlsx", StandardCharsets.UTF_8).replace("+", "%20");
        res.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + name);
        res.setContentLength(bytes.length);
        res.getOutputStream().write(bytes);
        res.flushBuffer();
    }

    // ----- 학교 -----
    @GetMapping("/schools/bulk/template")
    @RequirePerm("SCHOOL_CREATE")
    public void schoolTemplate(HttpServletResponse res) throws IOException { send(res, "학교일괄등록", schoolBulk.template(AuthContext.get())); }

    @PostMapping(value = "/schools/bulk/validate", consumes = XLSX)
    @RequirePerm("SCHOOL_CREATE")
    public ApiResponse schoolValidate(@RequestParam("file") MultipartFile file) throws IOException { return ApiResponse.ok(schoolBulk.validate(AuthContext.get(), file)); }

    @PostMapping(value = "/schools/bulk/commit", consumes = XLSX)
    @RequirePerm("SCHOOL_CREATE")
    public ApiResponse schoolCommit(@RequestParam("file") MultipartFile file, @RequestParam(required = false) Boolean skipErrors) throws IOException {
        return ApiResponse.ok(schoolBulk.commit(AuthContext.get(), file, Boolean.TRUE.equals(skipErrors)));
    }

    // ----- 무선망 장비 -----
    @GetMapping("/wireless-devices/bulk/template")
    @RequirePerm("WDEVICE_CREATE")
    public void wirelessTemplate(HttpServletResponse res) throws IOException { send(res, "무선장비일괄등록", deviceBulk.template(AuthContext.get(), "M")); }

    @PostMapping(value = "/wireless-devices/bulk/validate", consumes = XLSX)
    @RequirePerm("WDEVICE_CREATE")
    public ApiResponse wirelessValidate(@RequestParam("file") MultipartFile file) throws IOException { return ApiResponse.ok(deviceBulk.validate(AuthContext.get(), "M", file)); }

    @PostMapping(value = "/wireless-devices/bulk/commit", consumes = XLSX)
    @RequirePerm("WDEVICE_CREATE")
    public ApiResponse wirelessCommit(@RequestParam("file") MultipartFile file, @RequestParam(required = false) Boolean skipErrors) throws IOException {
        return ApiResponse.ok(deviceBulk.commit(AuthContext.get(), "M", file, Boolean.TRUE.equals(skipErrors)));
    }

    // ----- 스쿨넷 장비 -----
    @GetMapping("/schoolnet-devices/bulk/template")
    @RequirePerm("SDEVICE_CREATE")
    public void schoolnetTemplate(HttpServletResponse res) throws IOException { send(res, "스쿨넷장비일괄등록", deviceBulk.template(AuthContext.get(), "S")); }

    @PostMapping(value = "/schoolnet-devices/bulk/validate", consumes = XLSX)
    @RequirePerm("SDEVICE_CREATE")
    public ApiResponse schoolnetValidate(@RequestParam("file") MultipartFile file) throws IOException { return ApiResponse.ok(deviceBulk.validate(AuthContext.get(), "S", file)); }

    @PostMapping(value = "/schoolnet-devices/bulk/commit", consumes = XLSX)
    @RequirePerm("SDEVICE_CREATE")
    public ApiResponse schoolnetCommit(@RequestParam("file") MultipartFile file, @RequestParam(required = false) Boolean skipErrors) throws IOException {
        return ApiResponse.ok(deviceBulk.commit(AuthContext.get(), "S", file, Boolean.TRUE.equals(skipErrors)));
    }
}
