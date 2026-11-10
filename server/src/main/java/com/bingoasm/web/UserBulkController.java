package com.bingoasm.web;

import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.common.Times;
import com.bingoasm.service.UserBulkService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** 사용자 일괄 등록: 양식 → 검증 → 확정. 도교육청 관리자(USER_WRITE + ROLE_GRANT)만. */
@Tag(name = "사용자 일괄 등록", description = "엑셀 양식 → 검증 → 확정")
@RestController
@RequestMapping("/api/users/bulk")
@RequirePerm("USER_BULK")
public class UserBulkController {
    private final UserBulkService bulk;

    public UserBulkController(UserBulkService bulk) { this.bulk = bulk; }

    @GetMapping("/template")
    public void template(HttpServletResponse res) throws IOException {
        byte[] bytes = bulk.template(AuthContext.get());
        String name = URLEncoder.encode("사용자일괄등록_양식_" + Times.today() + ".xlsx", StandardCharsets.UTF_8).replace("+", "%20");
        res.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + name);
        res.setContentLength(bytes.length);
        res.getOutputStream().write(bytes);
        res.flushBuffer();
    }

    @PostMapping(value = "/validate", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse validate(@RequestParam("file") MultipartFile file) throws IOException {
        return ApiResponse.ok(bulk.validate(AuthContext.get(), file));
    }

    @PostMapping(value = "/commit", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse commit(@RequestParam("file") MultipartFile file, @RequestParam(required = false) Boolean skipErrors) throws IOException {
        return ApiResponse.ok(bulk.commit(AuthContext.get(), file, Boolean.TRUE.equals(skipErrors)));
    }
}
