package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.AsCostService;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** 통합관리 > 계약·예산 관리. 도교육청 관리자만. */
@Tag(name = "AS 계약·예산", description = "유지보수 계약(정액)과 연간 AS 예산. AS 비용 통계의 실제 지출·집행률 계산에 쓰인다")
@RestController
@RequestMapping("/api/as/cost")
@RequirePerm("COST_MANAGE")
public class AsCostController {
    private final AsCostService cost;

    public AsCostController(AsCostService cost) { this.cost = cost; }

    @GetMapping("/contracts")
    public ApiResponse contracts() { return ApiResponse.ok(cost.contracts(AuthContext.get())); }

    /** body: {vendorId, contractName, startDate, endDate, amount, serviceTypes:[C,M,S,T], allRegions, regionIds:[], note} */
    @PostMapping("/contracts")
    public ApiResponse createContract(@RequestBody Map<String, Object> body) { return ApiResponse.ok(cost.saveContract(AuthContext.get(), null, body)); }

    @PutMapping("/contracts/{id}")
    public ApiResponse updateContract(@PathVariable Long id, @RequestBody Map<String, Object> body) { return ApiResponse.ok(cost.saveContract(AuthContext.get(), id, body)); }

    @DeleteMapping("/contracts/{id}")
    public ApiResponse deleteContract(@PathVariable Long id) { cost.deleteContract(AuthContext.get(), id); return ApiResponse.ok(null); }

    @GetMapping("/budgets")
    public ApiResponse budgets(@RequestParam int year) { return ApiResponse.ok(cost.budgets(AuthContext.get(), year)); }

    /** 그 해 예산을 통째로 바꾼다. body: [{regionId?, rceptTy?, amount, note?}] (비우면 전체 지역·전체 구분) */
    @PutMapping("/budgets")
    public ApiResponse saveBudgets(@RequestParam int year, @RequestBody List<Map<String, Object>> rows) {
        return ApiResponse.ok(cost.saveBudgets(AuthContext.get(), year, rows));
    }
}
