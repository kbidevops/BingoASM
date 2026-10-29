package com.bingoasm.web;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.common.Times;
import com.bingoasm.service.ExcelWriter;
import com.bingoasm.service.ExcelWriter.Col;
import com.bingoasm.service.ServiceRequestService;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

@Tag(name = "서비스 요청(기존)", description = "기존 BingoASM 서비스 요청 접수·처리")
@RestController
@RequestMapping("/api/services")
public class ServiceRequestController {
    private final ServiceRequestService services;

    public ServiceRequestController(ServiceRequestService services) {
        this.services = services;
    }

    private static ServiceRequestService.Filter filter(String keyword, String status, String statusGroup, String requestType, String priority,
                                                       LocalDate fromDate, LocalDate toDate, Long assetId, Boolean myRequest, Boolean myTask, String sort) {
        return new ServiceRequestService.Filter(keyword, status, statusGroup, requestType, priority, fromDate, toDate, assetId,
                Boolean.TRUE.equals(myRequest), Boolean.TRUE.equals(myTask), sort);
    }

    @GetMapping
    @RequirePerm("SERVICE_READ")
    public ApiResponse list(@RequestParam(required = false) String keyword, @RequestParam(required = false) String status,
                            @RequestParam(required = false) String statusGroup, @RequestParam(required = false) String requestType,
                            @RequestParam(required = false) String priority,
                            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
                            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
                            @RequestParam(required = false) Long assetId, @RequestParam(required = false) Boolean myRequest,
                            @RequestParam(required = false) Boolean myTask, @RequestParam(required = false) String sort,
                            @RequestParam(required = false) Integer page, @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(services.list(AuthContext.get(),
                filter(keyword, status, statusGroup, requestType, priority, fromDate, toDate, assetId, myRequest, myTask, sort), page, size));
    }

    @GetMapping("/dashboard")
    @RequirePerm("SERVICE_READ")
    public ApiResponse dashboard() {
        return ApiResponse.ok(services.dashboard(AuthContext.get()));
    }

    @GetMapping("/excel")
    @RequirePerm("SERVICE_READ")
    public void excel(@RequestParam(required = false) String keyword, @RequestParam(required = false) String status,
                      @RequestParam(required = false) String statusGroup, @RequestParam(required = false) String requestType,
                      @RequestParam(required = false) String priority,
                      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
                      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
                      @RequestParam(required = false) Long assetId, @RequestParam(required = false) Boolean myRequest,
                      @RequestParam(required = false) Boolean myTask, @RequestParam(required = false) String sort,
                      HttpServletResponse res) throws IOException {
        var rows = services.listAll(AuthContext.get(),
                filter(keyword, status, statusGroup, requestType, priority, fromDate, toDate, assetId, myRequest, myTask, sort));
        try (ExcelWriter x = new ExcelWriter()) {
            x.sheet("서비스", List.of(Col.of("요청번호", "requestNo", 20), Col.of("유형", "requestType", 12), Col.of("우선순위", "priority", 10),
                    Col.of("제목", "title", 36), Col.of("상태", "status", 12), Col.of("요청자", "requesterName", 10), Col.of("요청일시", "requestAt", 20),
                    Col.of("자산번호", "assetNo"), Col.of("건물", "buildingName", 10), Col.of("층", "floorName", 8), Col.of("처리자", "processorName", 10),
                    Col.of("완료일시", "completedAt", 20), Col.of("작업시간(분)", "workMinutes", 12), Col.of("만족도", "overallScore", 8)), rows);
            x.write(res, "서비스목록_" + Times.today() + ".xlsx");
        }
    }

    @GetMapping("/{id}")
    @RequirePerm("SERVICE_READ")
    public ApiResponse detail(@PathVariable Long id) {
        return ApiResponse.ok(services.detail(AuthContext.get(), id));
    }

    /** Returns the new request id. */
    @PostMapping
    @RequirePerm("SERVICE_REQUEST")
    public ApiResponse create(@RequestBody Map<String, Object> body) {
        return ApiResponse.ok(services.create(AuthContext.get(), body));
    }

    /** receive | assign | start | hold | complete | close | reject | satisfaction */
    @PostMapping("/{id}/{action}")
    @RequirePerm("SERVICE_READ")
    public ApiResponse act(@PathVariable Long id, @PathVariable String action, @RequestBody(required = false) Map<String, Object> body) {
        services.act(AuthContext.get(), id, action, body == null ? new HashMap<>() : body);
        return ApiResponse.ok(services.detail(AuthContext.get(), id));
    }
}
