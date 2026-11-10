package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.WirelessDeviceService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** 자산관리 > 무선장비관리. 학교 사용자는 무선망 AS 신청 화면에서 자기 학교 장비를 고르기 위해 조회만 한다. */
@Tag(name = "기준정보 · 무선망 장비", description = "무선망 AS 신청에서 고르는 AP·스위치·컨트롤러")
@RestController
@RequestMapping("/api/as/wireless-devices")
public class WirelessDeviceController {
    private final WirelessDeviceService devices;

    public WirelessDeviceController(WirelessDeviceService devices) { this.devices = devices; }

    @GetMapping
    @RequirePerm({"WDEVICE_MANAGE", "AS_M_REQUEST", "AS_M_VIEW", "AS_PROCESS"})
    public ApiResponse list(@RequestParam(required = false) Long schoolId, @RequestParam(required = false) Long regionId,
                            @RequestParam(required = false) String deviceType, @RequestParam(required = false) String status,
                            @RequestParam(required = false) String keyword,
                            @RequestParam(required = false) Integer page, @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(devices.list(AuthContext.get(), "M", schoolId, regionId, deviceType, status, keyword, page, size));
    }

    @PostMapping
    @RequirePerm("WDEVICE_CREATE")
    public ApiResponse create(@RequestBody Map<String, Object> body) { return ApiResponse.ok(devices.create(AuthContext.get(), "M", body)); }

    /** 설치위치 고르기: 이 학교의 건물·층과 이미 쓴 상세 위치(실) 이름. */
    @GetMapping("/places")
    @RequirePerm("WDEVICE_MANAGE")
    public ApiResponse places(@RequestParam Long schoolId) { return ApiResponse.ok(devices.places(AuthContext.get(), schoolId)); }

    /** 위치 변경 기록 (최근 것부터). */
    @GetMapping("/{id}/history")
    @RequirePerm("WDEVICE_MANAGE")
    public ApiResponse history(@PathVariable Long id) { return ApiResponse.ok(devices.history(AuthContext.get(), "M", id)); }

    /** body에 unplace:true 를 함께 보내면 도면에서 빼고 새 설치위치를 적는다 (다른 층으로 옮기기). */
    @PutMapping("/{id}")
    @RequirePerm("WDEVICE_EDIT")
    public ApiResponse update(@PathVariable Long id, @RequestBody Map<String, Object> body) { return ApiResponse.ok(devices.update(AuthContext.get(), "M", id, body)); }

    /** 무선장비 위치(도면): {floorId, x, y} (x·y는 도면 대비 %) — floorId를 비우면 도면에서 뺀다. */
    @PutMapping("/{id}/position")
    @RequirePerm("WDEVICE_PLACE")
    public ApiResponse position(@PathVariable Long id, @RequestBody Map<String, Object> body) { return ApiResponse.ok(devices.position(AuthContext.get(), "M", id, body)); }

    @DeleteMapping("/{id}")
    @RequirePerm("WDEVICE_DELETE")
    public ApiResponse delete(@PathVariable Long id) { devices.delete(AuthContext.get(), "M", id); return ApiResponse.ok(null); }
}
