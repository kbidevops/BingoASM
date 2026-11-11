package com.bingoasm.web.as;

import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.ExcelWriter;
import com.bingoasm.service.ExcelWriter.Col;
import com.bingoasm.service.as.SlaService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** 네트워크 유지관리 › 스쿨넷 SLA 공유: SLA 기준과 월별 현황 · 보고서. 보는 권한은 SLA 게시판과 같다(BOARD_SLA). */
@Tag(name = "스쿨넷 SLA", description = "SLA 기준 · 월별 충족 현황 · 회선 가용률 · 보고서")
@RestController
@RequestMapping("/api/as/sla")
@RequirePerm("BOARD_SLA")
public class SlaController {
    private final SlaService sla;

    public SlaController(SlaService sla) { this.sla = sla; }

    @GetMapping
    public ApiResponse dashboard(@RequestParam(required = false) Integer year, @RequestParam(required = false) Integer month,
                                 @RequestParam(required = false) Long regionId) {
        return ApiResponse.ok(sla.dashboard(AuthContext.get(), year, month, regionId));
    }

    /** body: { receiveMin, visitMin, recoverFullMin, recoverPartialMin, availabilityPct } — 교육청 관리자만. */
    @PutMapping("/targets")
    public ApiResponse saveTargets(@RequestBody Map<String, Object> body) {
        return ApiResponse.ok(sla.saveTarget(AuthContext.get(), body));
    }

    @GetMapping("/excel")
    public void excel(@RequestParam(required = false) Integer year, @RequestParam(required = false) Integer month,
                      @RequestParam(required = false) Long regionId, HttpServletResponse res) throws IOException {
        var p = SlaService.period(year, month);
        Map<String, List<Map<String, Object>>> r = sla.report(AuthContext.get(), year, month, regionId);
        List<Col> group = List.of(Col.of("구분", "name", 18), Col.of("장애 건수", "total", 10), Col.of("충족", "met", 8), Col.of("위반", "missed", 8),
                Col.of("진행 중", "pending", 8), Col.of("충족률(%)", "metRate", 10), Col.of("평균 접수", "receive", 12), Col.of("평균 도착", "visit", 12),
                Col.of("평균 복구", "recover", 12));
        try (ExcelWriter x = new ExcelWriter()) {
            x.sheet("요약", List.of(Col.of("항목", "item", 30), Col.of("값", "value", 30)), r.get("요약"));
            x.sheet("업체별", group, r.get("업체별"));
            x.sheet("지역별", group, r.get("지역별"));
            x.sheet("회선별", List.of(Col.of("학교", "school", 18), Col.of("지역", "region", 10), Col.of("장비번호", "code", 14), Col.of("회선번호", "circuit", 16),
                    Col.of("통신사", "carrier", 10), Col.of("속도", "bandwidth", 10), Col.of("장애 횟수", "failures", 10), Col.of("장애 시간", "downtime", 14),
                    Col.of("가용률(%)", "availability", 10), Col.of("목표", "below", 8)), r.get("회선별"));
            x.sheet("위반 내역", List.of(Col.of("접수번호", "sn", 10), Col.of("학교", "school", 18), Col.of("지역", "region", 10), Col.of("업체", "vendor", 16),
                    Col.of("장애유형", "fault", 10), Col.of("신청일시", "requestAt", 18), Col.of("상태", "status", 10), Col.of("접수", "receive", 26),
                    Col.of("현장 도착", "visit", 26), Col.of("복구", "recover", 26), Col.of("위반 항목", "missed", 18)), r.get("위반 내역"));
            x.write(res, String.format("스쿨넷_SLA_보고서_%d-%02d.xlsx", p.year(), p.month()));
        }
    }
}
