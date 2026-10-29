package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.CurrentUser;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiException;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.common.Json;
import com.bingoasm.common.Times;
import com.bingoasm.domain.as.AsCodes;
import com.bingoasm.service.ExcelWriter;
import com.bingoasm.service.ExcelWriter.Col;
import com.bingoasm.service.as.AsRequestService;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

/**
 * AS 신청·결과조회·처리. 유형(C 정보기기 / M 무선망 / S 스쿨넷 / T 스마트기기)은 rceptTy 파라미터.
 * 권한은 서비스 안에서 유형별로 검사한다(AS_{ty}_REQUEST / AS_{ty}_VIEW / SMART_REQUEST / AS_PROCESS / AS_MANAGE).
 */
@Tag(name = "AS 신청·처리", description = "정보기기(C)·무선망(M)·스쿨넷(S)·스마트기기(T) 신청, 결과조회, 접수·방문·보고서·이관·반려·평가·배정")
@RestController
@RequestMapping("/api/as/requests")
public class AsRequestController {
    private static final List<String> VIEW_PERMS = List.of("AS_C_VIEW", "AS_M_VIEW", "AS_S_VIEW", "SMART_REQUEST", "AS_PROCESS", "AS_MANAGE");
    private final AsRequestService requests;

    public AsRequestController(AsRequestService requests) { this.requests = requests; }

    private static void requireAnyView(CurrentUser me) {
        if (VIEW_PERMS.stream().noneMatch(me::can)) throw ApiException.forbidden("권한이 없습니다.");
    }

    private static AsRequestService.Filter filter(String rceptTy, String keyword, String searchType, LocalDate fromDate, LocalDate toDate, String status,
                                                  Long schoolId, Long regionId, Long vendorId, Long engineerUserId, Boolean mine, Boolean unassigned, String sort) {
        return new AsRequestService.Filter(rceptTy, keyword, searchType, fromDate, toDate, status, schoolId, regionId, vendorId, engineerUserId,
                Boolean.TRUE.equals(mine), Boolean.TRUE.equals(unassigned), sort);
    }

    /** 코드표: 접수유형·상태·고장유형·요청유형·처리유형. 화면 셀렉트 박스용. */
    @GetMapping("/codes")
    public ApiResponse codes() {
        return ApiResponse.ok(Json.obj().with("rceptTypes", AsCodes.RCEPT_TY_NAME).with("statuses", AsCodes.STATUS_NAME)
                .with("faultTypes", AsCodes.FAULT_TYPES).with("requestTypes", AsCodes.REQUEST_TYPE_NAME).with("processTypes", AsCodes.PROCESS_TYPE_NAME)
                .with("costTypes", AsCodes.COST_TYPE_NAME).with("chargeTypes", AsCodes.CHARGE_TYPE_NAME));
    }

    /** 결과조회 목록. searchType: school|applicant|region, status: A|R|C|X */
    @GetMapping
    public ApiResponse list(@RequestParam(required = false) String rceptTy, @RequestParam(required = false) String keyword,
                            @RequestParam(required = false) String searchType,
                            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
                            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
                            @RequestParam(required = false) String status, @RequestParam(required = false) Long schoolId,
                            @RequestParam(required = false) Long regionId, @RequestParam(required = false) Long vendorId,
                            @RequestParam(required = false) Long engineerUserId, @RequestParam(required = false) Boolean mine,
                            @RequestParam(required = false) Boolean unassigned, @RequestParam(required = false) String sort,
                            @RequestParam(required = false) Integer page, @RequestParam(required = false) Integer size) {
        CurrentUser me = AuthContext.get();
        requireAnyView(me);
        return ApiResponse.ok(requests.list(me, filter(rceptTy, keyword, searchType, fromDate, toDate, status, schoolId, regionId, vendorId, engineerUserId, mine, unassigned, sort), page, size));
    }

    /** 대시보드 요약(유형별·상태별 건수, 내 처리 대기). */
    @GetMapping("/summary")
    public ApiResponse summary() {
        CurrentUser me = AuthContext.get();
        requireAnyView(me);
        return ApiResponse.ok(requests.summary(me));
    }

    @GetMapping("/excel")
    public void excel(@RequestParam(required = false) String rceptTy, @RequestParam(required = false) String keyword,
                      @RequestParam(required = false) String searchType,
                      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
                      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
                      @RequestParam(required = false) String status, @RequestParam(required = false) Long schoolId,
                      @RequestParam(required = false) Long regionId, @RequestParam(required = false) Long vendorId,
                      @RequestParam(required = false) Long engineerUserId, @RequestParam(required = false) Boolean mine,
                      @RequestParam(required = false) String sort, HttpServletResponse res) throws IOException {
        CurrentUser me = AuthContext.get();
        requireAnyView(me);
        var rows = requests.listAll(me, filter(rceptTy, keyword, searchType, fromDate, toDate, status, schoolId, regionId, vendorId, engineerUserId, mine, null, sort));
        try (ExcelWriter x = new ExcelWriter()) {
            x.sheet("AS신청", List.of(Col.of("번호", "asvcSn", 8), Col.of("유형", "rceptTyName", 10), Col.of("학교명", "schoolName", 18), Col.of("지역", "regionName", 12),
                    Col.of("신청자", "applicantName", 10), Col.of("연락처", "contactTel", 14), Col.of("증상", "symptom", 40), Col.of("신청일자", "requestAt", 18),
                    Col.of("접수일자", "receivedAt", 18), Col.of("방문예정", "visitPlannedAt", 18), Col.of("처리일자", "completedAt", 18),
                    Col.of("업체", "vendorName", 16), Col.of("기사", "engineerName", 10), Col.of("상태", "statusName", 10),
                    Col.of("처리유형", "processTypeName", 12), Col.of("만족도", "evalScore", 8)), rows);
            x.write(res, "AS신청_" + Times.today() + ".xlsx");
        }
    }

    @GetMapping("/{sn}")
    public ApiResponse detail(@PathVariable Long sn) {
        CurrentUser me = AuthContext.get();
        requireAnyView(me);
        return ApiResponse.ok(requests.detail(me, sn));
    }

    /** 신청. body에 rceptTy 필수. 반환: 새 번호(asvcSn). */
    @PostMapping
    public ApiResponse create(@RequestBody Map<String, Object> body) {
        CurrentUser me = AuthContext.get();
        Long sn = requests.create(me, body);
        return ApiResponse.ok(requests.detail(me, sn));
    }

    @PutMapping("/{sn}")
    public ApiResponse update(@PathVariable Long sn, @RequestBody Map<String, Object> body) {
        CurrentUser me = AuthContext.get();
        requests.update(me, sn, body);
        return ApiResponse.ok(requests.detail(me, sn));
    }

    /** 처리: receive · return · return-cancel · transfer · cancel · visit · report · evaluate · assign · delete */
    @PostMapping("/{sn}/{action}")
    public ApiResponse act(@PathVariable Long sn, @PathVariable String action, @RequestBody(required = false) Map<String, Object> body) {
        CurrentUser me = AuthContext.get();
        Map<String, Object> b = body == null ? Map.of() : body;
        requests.act(me, sn, action, b);
        if ("delete".equals(action) || "cancel".equals(action)) return ApiResponse.ok(null);
        try {
            return ApiResponse.ok(requests.detail(me, sn));
        } catch (ApiException e) {
            // 이관 후에는 이관한 업체 기사가 더 이상 볼 수 없다 → 결과만 돌려준다.
            if (!"transfer".equals(action)) throw e;
            return ApiResponse.ok(Json.obj().with("asvcSn", sn).with("transferred", true).with("rceptTy", b.get("rceptTy"))
                    .with("message", AsCodes.RCEPT_TY_NAME.get(String.valueOf(b.get("rceptTy"))) + " AS로 이관되었습니다."));
        }
    }

    @DeleteMapping("/{sn}")
    @RequirePerm("AS_MANAGE")
    public ApiResponse delete(@PathVariable Long sn) {
        requests.act(AuthContext.get(), sn, "delete", Map.of());
        return ApiResponse.ok(null);
    }
}
