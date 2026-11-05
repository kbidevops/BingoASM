package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.WirelessDeviceService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** 자산관리 > 스쿨넷장비관리: 학교 인터넷망(스쿨넷)의 라우터·스위치·보안장비와 회선 정보. 무선장비와 같은 규칙. */
@Tag(name = "기준정보 · 스쿨넷 장비", description = "학교 스쿨넷 회선의 라우터·L3/L2 스위치·보안장비")
@RestController
@RequestMapping("/api/as/schoolnet-devices")
public class SchoolNetDeviceController {
    private final WirelessDeviceService devices;

    public SchoolNetDeviceController(WirelessDeviceService devices) { this.devices = devices; }

    @GetMapping
    @RequirePerm("SDEVICE_MANAGE")
    public ApiResponse list(@RequestParam(required = false) Long schoolId, @RequestParam(required = false) Long regionId,
                            @RequestParam(required = false) String deviceType, @RequestParam(required = false) String status,
                            @RequestParam(required = false) String keyword,
                            @RequestParam(required = false) Integer page, @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(devices.list(AuthContext.get(), "S", schoolId, regionId, deviceType, status, keyword, page, size));
    }

    @PostMapping
    @RequirePerm("SDEVICE_MANAGE")
    public ApiResponse create(@RequestBody Map<String, Object> body) { return ApiResponse.ok(devices.create(AuthContext.get(), "S", body)); }

    @PutMapping("/{id}")
    @RequirePerm("SDEVICE_MANAGE")
    public ApiResponse update(@PathVariable Long id, @RequestBody Map<String, Object> body) { return ApiResponse.ok(devices.update(AuthContext.get(), "S", id, body)); }

    @DeleteMapping("/{id}")
    @RequirePerm("SDEVICE_MANAGE")
    public ApiResponse delete(@PathVariable Long id) { devices.delete(AuthContext.get(), "S", id); return ApiResponse.ok(null); }
}
