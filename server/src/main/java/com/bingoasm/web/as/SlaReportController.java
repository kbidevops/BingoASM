package com.bingoasm.web.as;

import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.SlaReportService;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/**
 * 네트워크 유지관리 › 스쿨넷 SLA 결과 업로드. 통신사가 월별 SLA 결과 파일(한글 · 엑셀)을 올리고 교육청이 승인한다.
 * 파일은 먼저 POST /api/files로 올려 fileId를 받는다. 메뉴 권한은 BOARD_SLA.
 */
@Tag(name = "스쿨넷 SLA 결과", description = "통신사의 월별 SLA 결과 파일 업로드 · 교육청 승인")
@RestController
@RequestMapping("/api/as/sla-reports")
@RequirePerm("BOARD_SLA")
public class SlaReportController {
    private final SlaReportService reports;

    public SlaReportController(SlaReportService reports) { this.reports = reports; }

    /** 교육청 = 모두, 업체 = 자기 업체 것, 교육지원청 = 승인된 것 + 승인할 수 있는 것, 학교 = 승인된 것만. 최근에 올린 순. */
    @GetMapping
    public ApiResponse list(@RequestParam(required = false) Long vendorId, @RequestParam(required = false) String status) {
        return ApiResponse.ok(reports.list(AuthContext.get(), vendorId, status));
    }

    /** body: { reportId?, title, periodFrom?, periodTo?, note?, fileIds: [..] } — 스쿨넷 업체의 업체 관리자 · 기사. reportId가 있으면 그 결과를 고친다(승인 전만). */
    @PostMapping
    public ApiResponse submit(@RequestBody Map<String, Object> body) {
        return ApiResponse.ok(reports.submit(AuthContext.get(), body));
    }

    @DeleteMapping("/{id}")
    public ApiResponse delete(@PathVariable Long id) {
        reports.delete(AuthContext.get(), id);
        return ApiResponse.ok(null);
    }

    @PostMapping("/{id}/approve")
    public ApiResponse approve(@PathVariable Long id) {
        return ApiResponse.ok(reports.approve(AuthContext.get(), id));
    }

    /** body: { reason } */
    @PostMapping("/{id}/reject")
    public ApiResponse reject(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return ApiResponse.ok(reports.reject(AuthContext.get(), id, body));
    }
}
