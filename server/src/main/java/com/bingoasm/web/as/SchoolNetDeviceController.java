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

    /** 학교 담당자·기사도 스쿨넷 AS 신청·처리에서 자기 범위의 장비를 고르려고 조회한다 (수정은 관리 권한만). */
    @GetMapping
    @RequirePerm({"SDEVICE_MANAGE", "AS_S_REQUEST", "AS_S_VIEW", "AS_PROCESS"})
    public ApiResponse list(@RequestParam(required = false) Long schoolId, @RequestParam(required = false) Long regionId,
                            @RequestParam(required = false) String deviceType, @RequestParam(required = false) String status,
                            @RequestParam(required = false) String keyword,
                            @RequestParam(required = false) Integer page, @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(devices.list(AuthContext.get(), "S", schoolId, regionId, deviceType, status, keyword, page, size));
    }

    @PostMapping
    @RequirePerm("SDEVICE_CREATE")
    public ApiResponse create(@RequestBody Map<String, Object> body) { return ApiResponse.ok(devices.create(AuthContext.get(), "S", body)); }

    /** 설치위치 고르기: 이 학교의 건물·층과 이미 쓴 상세 위치(실) 이름. */
    @GetMapping("/places")
    @RequirePerm("SDEVICE_MANAGE")
    public ApiResponse places(@RequestParam Long schoolId) { return ApiResponse.ok(devices.places(AuthContext.get(), schoolId)); }

    /** 위치 변경 기록 (최근 것부터). */
    @GetMapping("/{id}/history")
    @RequirePerm("SDEVICE_MANAGE")
    public ApiResponse history(@PathVariable Long id) { return ApiResponse.ok(devices.history(AuthContext.get(), "S", id)); }

    /** body에 unplace:true 를 함께 보내면 도면에서 빼고 새 설치위치를 적는다 (다른 층으로 옮기기). */
    @PutMapping("/{id}")
    @RequirePerm("SDEVICE_EDIT")
    public ApiResponse update(@PathVariable Long id, @RequestBody Map<String, Object> body) { return ApiResponse.ok(devices.update(AuthContext.get(), "S", id, body)); }

    @DeleteMapping("/{id}")
    @RequirePerm("SDEVICE_DELETE")
    public ApiResponse delete(@PathVariable Long id) { devices.delete(AuthContext.get(), "S", id); return ApiResponse.ok(null); }
}
