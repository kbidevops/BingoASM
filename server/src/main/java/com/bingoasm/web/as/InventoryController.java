package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.InventoryService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** 재물조사(QR 스캔). */
@Tag(name = "재물조사(QR)", description = "실 선택 → 라벨 스캔 → 보고서 → 이동 반영")
@RestController
@RequestMapping("/api/as/inventory")
@RequirePerm("INVENTORY")
public class InventoryController {
    private final InventoryService inventory;

    public InventoryController(InventoryService inventory) { this.inventory = inventory; }

    @GetMapping
    public ApiResponse sessions(@RequestParam Long schoolId) { return ApiResponse.ok(inventory.sessions(AuthContext.get(), schoolId)); }

    /** body: { schoolId, title? } */
    @PostMapping
    public ApiResponse start(@RequestBody Map<String, Object> body) { return ApiResponse.ok(inventory.start(AuthContext.get(), body)); }

    @GetMapping("/{id}")
    public ApiResponse report(@PathVariable Long id) { return ApiResponse.ok(inventory.report(AuthContext.get(), id)); }

    /** body: { roomId, assetNo | text } → result FOUND / MOVED / UNKNOWN / DUPLICATE */
    @PostMapping("/{id}/scans")
    public ApiResponse scan(@PathVariable Long id, @RequestBody Map<String, Object> body) { return ApiResponse.ok(inventory.scan(AuthContext.get(), id, body)); }

    /** 실 조사 완료 표시/해제. body: { done: true|false } */
    @PutMapping("/{id}/rooms/{roomId}")
    public ApiResponse completeRoom(@PathVariable Long id, @PathVariable Long roomId, @RequestBody(required = false) Map<String, Object> body) {
        boolean done = body == null || !Boolean.FALSE.equals(body.get("done"));
        return ApiResponse.ok(inventory.completeRoom(AuthContext.get(), id, roomId, done));
    }

    /** 이동 발견 자산을 스캔한 실로 반영. body: { scanIds?:[...] } */
    @PostMapping("/{id}/apply-moves")
    public ApiResponse applyMoves(@PathVariable Long id, @RequestBody(required = false) Map<String, Object> body) {
        return ApiResponse.ok(inventory.applyMoves(AuthContext.get(), id, body == null ? Map.of() : body));
    }

    @PostMapping("/{id}/close")
    public ApiResponse close(@PathVariable Long id) { return ApiResponse.ok(inventory.close(AuthContext.get(), id)); }
}
