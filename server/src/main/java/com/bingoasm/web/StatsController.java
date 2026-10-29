package com.bingoasm.web;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.common.Json;
import com.bingoasm.service.ExcelWriter;
import com.bingoasm.service.ExcelWriter.Col;
import com.bingoasm.service.StatsService;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

@Tag(name = "통계(기존)", description = "기존 BingoASM 서비스 통계")
@RestController
@RequestMapping("/api/stats")
public class StatsController {
    private final StatsService stats;

    public StatsController(StatsService stats) {
        this.stats = stats;
    }

    @GetMapping("/services")
    @RequirePerm("STATS_READ")
    public ApiResponse services(@RequestParam(required = false) String period,
                                @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
                                @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
                                @RequestParam(required = false) String requestType) {
        return ApiResponse.ok(stats.compute(AuthContext.get(), period, fromDate, toDate, requestType));
    }

    @GetMapping("/services/excel")
    @RequirePerm({"STATS_READ", "STATS_EXPORT"})
    @SuppressWarnings("unchecked")
    public void excel(@RequestParam(required = false) String period,
                      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
                      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
                      @RequestParam(required = false) String requestType, HttpServletResponse res) throws IOException {
        Json s = stats.compute(AuthContext.get(), period, fromDate, toDate, requestType);
        try (ExcelWriter x = new ExcelWriter()) {
            x.sheet("기간별", List.of(Col.of("기간", "periodKey"), Col.of("요청", "requestCnt"), Col.of("접수", "receivedCnt"), Col.of("완료", "completedCnt"),
                    Col.of("미결", "openCnt"), Col.of("반려", "rejectedCnt"), Col.of("평균 처리(h)", "avgLeadHours"), Col.of("만족도", "avgScore")), (List<Json>) s.get("series"));
            x.sheet("유형별", List.of(Col.of("유형", "requestType"), Col.of("건수", "totalCnt"), Col.of("완료", "completedCnt"), Col.of("평균 처리(h)", "avgLeadHours")),
                    (List<Json>) s.get("byRequestType"));
            x.sheet("처리자별", List.of(Col.of("처리자", "processorName"), Col.of("배정", "totalCnt"), Col.of("완료", "completedCnt"),
                    Col.of("평균 처리(h)", "avgLeadHours"), Col.of("만족도", "avgScore")), (List<Json>) s.get("byProcessor"));
            x.sheet("위치별", List.of(Col.of("건물", "buildingName"), Col.of("층", "floorName"), Col.of("건수", "totalCnt")), (List<Json>) s.get("byLocation"));
            x.sheet("자산별", List.of(Col.of("자산번호", "assetNo"), Col.of("자산명", "assetName"), Col.of("제조사", "manufacturer"),
                    Col.of("제품명", "modelName"), Col.of("건수", "totalCnt")), (List<Json>) s.get("topAssets"));
            x.write(res, "서비스통계_" + s.get("period") + "_" + s.get("fromDate") + "_" + s.get("toDate") + ".xlsx");
        }
    }
}
