package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.AsAlertService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** AS 지연 알림 기준 (교육청 전체 설정 — 도교육청만, ORG_WRITE). */
@Tag(name = "AS 지연 알림", description = "접수 지연 · 에스컬레이션 · 방문 지연 기준과 즉시 확인")
@RestController
@RequestMapping("/api/org/alert-rules")
public class AsAlertController {
    private final AsAlertService alerts;

    public AsAlertController(AsAlertService alerts) { this.alerts = alerts; }

    @GetMapping
    @RequirePerm("ORG_WRITE")
    public ApiResponse get() { return ApiResponse.ok(alerts.view(AuthContext.get().orgId())); }

    @PutMapping
    @RequirePerm("ORG_WRITE")
    public ApiResponse save(@RequestBody Map<String, Object> body) { return ApiResponse.ok(alerts.save(AuthContext.get(), body)); }

    /** 근무 시간 달력 (지연 알림을 근무 시간으로 셀 때): { workDays, startTime, endTime, holidays[{date, name}], isDefault, workingNow } */
    @GetMapping("/calendar")
    @RequirePerm("ORG_WRITE")
    public ApiResponse calendar() { return ApiResponse.ok(alerts.calendarView(AuthContext.get().orgId())); }

    @PutMapping("/calendar")
    @RequirePerm("ORG_WRITE")
    public ApiResponse saveCalendar(@RequestBody Map<String, Object> body) { return ApiResponse.ok(alerts.saveCalendar(AuthContext.get(), body)); }

    /** 다음 정기 확인(5분마다)을 기다리지 않고 지금 확인한다. 보낸 알림 수를 돌려준다. */
    @PostMapping("/run")
    @RequirePerm("ORG_WRITE")
    public ApiResponse run() { return ApiResponse.ok(alerts.run(AuthContext.get().orgId())); }
}
