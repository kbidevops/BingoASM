package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.WorkflowService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** AS 처리 흐름 (교육청 전체 설정 — 바꾸기는 도교육청만, ORG_WRITE). 장애접수관리를 가진 계정은 볼 수 있다. */
@Tag(name = "AS 처리 흐름", description = "AS 유형마다 첫 접수처 · 대상 장비 · 업체 결정 · 기사 배정 · 직접 처리 · 도착 기록 · 만족도 평가")
@RestController
@RequestMapping("/api/org/workflows")
public class WorkflowController {
    private final WorkflowService workflows;

    public WorkflowController(WorkflowService workflows) { this.workflows = workflows; }

    @GetMapping
    @RequirePerm({"ORG_WRITE", "AS_MANAGE"})
    public ApiResponse get() { return ApiResponse.ok(workflows.view(AuthContext.get().orgId())); }

    @PutMapping
    @RequirePerm("ORG_WRITE")
    public ApiResponse save(@RequestBody Map<String, Object> body) { return ApiResponse.ok(workflows.save(AuthContext.get(), body)); }
}
