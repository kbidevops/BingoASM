package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.SpaceService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/**
 * 공간(도면): 학교별 건물 → 층(도면 이미지는 /api/places/floors/{id}/plan 업로드 재사용) → 실(도면 위 사각형).
 * 자산 위치 파악은 실 단위로: 실 QR·도면 클릭 → 실에 등록된 자산 목록.
 */
@Tag(name = "공간 · 도면·실", description = "학교별 건물 → 층(도면) → 실, 실별 자산, 자산 실 배정")
@RestController
@RequestMapping("/api/as/spaces")
public class SpaceController {
    private final SpaceService spaces;

    public SpaceController(SpaceService spaces) { this.spaces = spaces; }

    @GetMapping("/buildings")
    @RequirePerm({"FLOOR_READ", "SPACE_MANAGE", "INVENTORY"})
    public ApiResponse buildings(@RequestParam Long schoolId) { return ApiResponse.ok(spaces.buildings(AuthContext.get(), schoolId)); }

    /** body: { schoolId, buildingName, address?, floorCount? } — floorCount만큼 1층부터 층을 함께 만든다. */
    @PostMapping("/buildings")
    @RequirePerm("SPACE_MANAGE")
    public ApiResponse createBuilding(@RequestBody Map<String, Object> body) { return ApiResponse.ok(spaces.createBuilding(AuthContext.get(), body)); }

    /** body: { floorNo, floorName? } */
    @PostMapping("/buildings/{id}/floors")
    @RequirePerm("SPACE_MANAGE")
    public ApiResponse addFloor(@PathVariable Long id, @RequestBody Map<String, Object> body) { return ApiResponse.ok(spaces.addFloor(AuthContext.get(), id, body)); }

    @DeleteMapping("/buildings/{id}")
    @RequirePerm("SPACE_MANAGE")
    public ApiResponse deleteBuilding(@PathVariable Long id) { spaces.deleteBuilding(AuthContext.get(), id); return ApiResponse.ok(null); }

    @GetMapping("/rooms")
    @RequirePerm({"FLOOR_READ", "SPACE_MANAGE", "INVENTORY"})
    public ApiResponse rooms(@RequestParam Long schoolId, @RequestParam(required = false) Long floorId) {
        return ApiResponse.ok(spaces.rooms(AuthContext.get(), schoolId, floorId));
    }

    /** 실 상세 + 등록 자산 목록(실 QR을 찍었을 때 보여 주는 화면). */
    @GetMapping("/rooms/{id}")
    @RequirePerm({"FLOOR_READ", "SPACE_MANAGE", "INVENTORY"})
    public ApiResponse room(@PathVariable Long id) { return ApiResponse.ok(spaces.room(AuthContext.get(), id)); }

    /** body: { schoolId, buildingId?, floorId?, roomNo?, roomName, roomType?, ownerName?, rect?:{x,y,w,h} } */
    @PostMapping("/rooms")
    @RequirePerm("SPACE_MANAGE")
    public ApiResponse createRoom(@RequestBody Map<String, Object> body) { return ApiResponse.ok(spaces.createRoom(AuthContext.get(), body)); }

    /** rect 만 보내면 도면 위 위치만 바뀐다(placeAt). rect:null 이면 도면에서 뗀다. */
    @PutMapping("/rooms/{id}")
    @RequirePerm("SPACE_MANAGE")
    public ApiResponse updateRoom(@PathVariable Long id, @RequestBody Map<String, Object> body) { return ApiResponse.ok(spaces.updateRoom(AuthContext.get(), id, body)); }

    @DeleteMapping("/rooms/{id}")
    @RequirePerm("SPACE_MANAGE")
    public ApiResponse deleteRoom(@PathVariable Long id) { spaces.deleteRoom(AuthContext.get(), id); return ApiResponse.ok(null); }

    /** 자산을 실로 배정(assignRoom). body: { roomId, assetIds:[...], how? } */
    @PostMapping("/rooms/move-assets")
    @RequirePerm({"SPACE_MANAGE", "INVENTORY"})
    public ApiResponse moveAssets(@RequestBody Map<String, Object> body) { return ApiResponse.ok(spaces.moveAssets(AuthContext.get(), body)); }
}
