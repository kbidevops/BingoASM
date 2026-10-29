package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.WirelessDeviceService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** 통합관리 > 무선망장비관리. 학교 사용자는 무선망 AS 신청 화면에서 자기 학교 장비를 고르기 위해 조회만 한다. */
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
        return ApiResponse.ok(devices.list(AuthContext.get(), schoolId, regionId, deviceType, status, keyword, page, size));
    }

    @PostMapping
    @RequirePerm("WDEVICE_MANAGE")
    public ApiResponse create(@RequestBody Map<String, Object> body) { return ApiResponse.ok(devices.create(AuthContext.get(), body)); }

    @PutMapping("/{id}")
    @RequirePerm("WDEVICE_MANAGE")
    public ApiResponse update(@PathVariable Long id, @RequestBody Map<String, Object> body) { return ApiResponse.ok(devices.update(AuthContext.get(), id, body)); }

    @DeleteMapping("/{id}")
    @RequirePerm("WDEVICE_MANAGE")
    public ApiResponse delete(@PathVariable Long id) { devices.delete(AuthContext.get(), id); return ApiResponse.ok(null); }
}
