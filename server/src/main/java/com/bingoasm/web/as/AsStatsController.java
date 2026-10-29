package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.AsStatsService;
import org.springframework.web.bind.annotation.*;

/** 통합관리 > AS통계관리(비용·건수·만족도). */
@Tag(name = "AS 통계", description = "월별·유형별·지역별·업체별 건수와 비용, 만족도")
@RestController
@RequestMapping("/api/as/stats")
@RequirePerm("AS_STATS")
public class AsStatsController {
    private final AsStatsService stats;

    public AsStatsController(AsStatsService stats) { this.stats = stats; }

    @GetMapping("/monthly")
    public ApiResponse monthly(@RequestParam(required = false) Integer year, @RequestParam(required = false) String rceptTy,
                               @RequestParam(required = false) Long regionId) {
        return ApiResponse.ok(stats.monthly(AuthContext.get(), year, rceptTy, regionId));
    }

    @GetMapping("/satisfaction")
    public ApiResponse satisfaction(@RequestParam(required = false) Integer year, @RequestParam(required = false) String rceptTy,
                                    @RequestParam(required = false) Long regionId,
                                    @RequestParam(required = false) Integer page, @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(stats.satisfaction(AuthContext.get(), year, rceptTy, regionId, page, size));
    }
}
