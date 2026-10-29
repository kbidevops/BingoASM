package com.bingoasm.web;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.CurrentUser;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.common.Times;
import com.bingoasm.service.AssetService;
import com.bingoasm.service.ExcelWriter;
import com.bingoasm.service.ExcelWriter.Col;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

@Tag(name = "자산(기존)", description = "자산 목록·상세·등록·수정·도면 위치·엑셀")
@RestController
@RequestMapping("/api/assets")
public class AssetController {
    private final AssetService assets;

    public AssetController(AssetService assets) {
        this.assets = assets;
    }

    private static AssetService.Filter filter(String keyword, String assetType, Long categoryId, String status, Long buildingId, Long floorId,
                                              LocalDate acquiredFrom, LocalDate acquiredTo, Boolean unplacedOnly, Boolean unplaced, String sort) {
        return new AssetService.Filter(keyword, assetType, categoryId, status, buildingId, floorId, acquiredFrom, acquiredTo,
                Boolean.TRUE.equals(unplacedOnly) || Boolean.TRUE.equals(unplaced), sort);
    }

    @GetMapping
    @RequirePerm("ASSET_READ")
    public ApiResponse list(@RequestParam(required = false) String keyword, @RequestParam(required = false) String assetType,
                            @RequestParam(required = false) Long categoryId, @RequestParam(required = false) String status,
                            @RequestParam(required = false) Long buildingId, @RequestParam(required = false) Long floorId,
                            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate acquiredFrom,
                            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate acquiredTo,
                            @RequestParam(required = false) Boolean unplacedOnly, @RequestParam(required = false) Boolean unplaced,
                            @RequestParam(required = false) String sort,
                            @RequestParam(required = false) Long schoolId, @RequestParam(required = false) Long roomId,
                            @RequestParam(required = false) Integer page, @RequestParam(required = false) Integer size) {
        AssetService.Filter f = filter(keyword, assetType, categoryId, status, buildingId, floorId, acquiredFrom, acquiredTo, unplacedOnly, unplaced, sort);
        // 학교 사용자는 자기 학교 자산만 (AssetService.scope가 다시 걸러 낸다).
        CurrentUser me = AuthContext.get();
        if (me.scope().school()) schoolId = me.scope().schoolId() == null ? -1L : me.scope().schoolId();
        f = new AssetService.Filter(f.keyword(), f.assetType(), f.categoryId(), f.status(), f.buildingId(), f.floorId(),
                f.acquiredFrom(), f.acquiredTo(), f.unplacedOnly(), f.sort(), schoolId, roomId);
        return ApiResponse.ok(assets.list(me, f, page, size));
    }

    @GetMapping("/summary")
    @RequirePerm("ASSET_READ")
    public ApiResponse summary() {
        return ApiResponse.ok(assets.summary(AuthContext.get()));
    }

    @GetMapping("/categories")
    public ApiResponse categories() {
        return ApiResponse.ok(assets.categories());
    }

    @GetMapping("/excel")
    @RequirePerm("ASSET_READ")
    public void excel(@RequestParam(required = false) String keyword, @RequestParam(required = false) String assetType,
                      @RequestParam(required = false) Long categoryId, @RequestParam(required = false) String status,
                      @RequestParam(required = false) Long buildingId, @RequestParam(required = false) Long floorId,
                      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate acquiredFrom,
                      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate acquiredTo,
                      @RequestParam(required = false) Boolean unplacedOnly, @RequestParam(required = false) String sort,
                      HttpServletResponse res) throws IOException {
        var rows = assets.listAll(AuthContext.get(),
                filter(keyword, assetType, categoryId, status, buildingId, floorId, acquiredFrom, acquiredTo, unplacedOnly, null, sort));
        try (ExcelWriter x = new ExcelWriter()) {
            x.sheet("자산", List.of(Col.of("자산번호", "assetNo"), Col.of("구분", "assetType", 8), Col.of("분류", "categoryName", 14),
                    Col.of("자산명", "assetName", 20), Col.of("제조사", "manufacturer", 14), Col.of("모델", "modelName"), Col.of("S/N", "serialNo", 14),
                    Col.of("상태", "status", 10), Col.of("건물", "buildingName", 10), Col.of("층", "floorName", 8), Col.of("위치", "locationDetail", 24),
                    Col.of("사용자", "ownerName", 10), Col.of("부서", "deptName", 12), Col.of("취득일", "acquiredAt", 12), Col.of("취득가", "acquirePrice", 12)), rows);
            x.write(res, "자산목록_" + Times.today() + ".xlsx");
        }
    }

    @GetMapping("/by-floor/{floorId}")
    @RequirePerm({"FLOOR_READ", "ASSET_READ"})
    public ApiResponse byFloor(@PathVariable Long floorId) {
        return ApiResponse.ok(assets.byFloor(AuthContext.get(), floorId));
    }

    @GetMapping("/{id}")
    @RequirePerm("ASSET_READ")
    public ApiResponse detail(@PathVariable Long id) {
        return ApiResponse.ok(assets.detail(AuthContext.get(), id));
    }

    @GetMapping("/{id}/histories")
    @RequirePerm("ASSET_READ")
    public ApiResponse histories(@PathVariable Long id) {
        return ApiResponse.ok(assets.histories(AuthContext.get(), id));
    }

    /** Returns the new asset id. */
    @PostMapping
    @RequirePerm("ASSET_WRITE")
    public ApiResponse create(@RequestBody Map<String, Object> body) {
        return ApiResponse.ok(assets.create(AuthContext.get(), body));
    }

    @PutMapping("/{id}")
    @RequirePerm("ASSET_WRITE")
    public ApiResponse update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        assets.update(AuthContext.get(), id, body);
        return ApiResponse.ok(assets.detail(AuthContext.get(), id));
    }

    @PatchMapping("/{id}/position")
    @RequirePerm("FLOOR_WRITE")
    public ApiResponse position(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        assets.position(AuthContext.get(), id, body);
        return ApiResponse.ok(assets.detail(AuthContext.get(), id));
    }

    @DeleteMapping("/{id}")
    @RequirePerm("ASSET_DELETE")
    public ApiResponse delete(@PathVariable Long id) {
        assets.delete(AuthContext.get(), id);
        return ApiResponse.ok(null);
    }
}
