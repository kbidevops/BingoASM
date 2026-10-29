package com.bingoasm.web;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.CurrentUser;
import com.bingoasm.auth.PermissionService;
import com.bingoasm.auth.PublicApi;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiException;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.common.Json;
import com.bingoasm.domain.Org;
import com.bingoasm.domain.as.AsCodes;
import com.bingoasm.repo.OrgRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/**
 * 교육청별 AS 서비스 사용 설정. 쓰지 않는 서비스는 그 교육청의 메뉴·신청·이관에서 빠진다 (PermissionService).
 * 이미 있는 신청 데이터는 지우지 않는다 — 다시 켜면 그대로 보인다.
 */
@Tag(name = "AS 서비스 설정", description = "교육청별 사용 AS 서비스")
@RestController
public class OrgServiceController {
    private final OrgRepository orgs;
    private final PermissionService permissions;

    public OrgServiceController(OrgRepository orgs, PermissionService permissions) {
        this.orgs = orgs;
        this.permissions = permissions;
    }

    /** 로그인 전 화면(메뉴·사이트맵)이 쓰는 사이트 정보. */
    @PublicApi
    @GetMapping("/api/site")
    public ApiResponse site() {
        Org org = permissions.siteOrg();
        Long orgId = org == null ? null : org.orgId;
        return ApiResponse.ok(Json.obj().with("orgName", org == null ? null : org.orgName)
                .with("asTypes", permissions.asTypes(orgId))
                .with("disabledPerms", new ArrayList<>(permissions.disabledPerms(orgId))));
    }

    @GetMapping("/api/org/as-services")
    @RequirePerm({"ORG_READ", "ORG_WRITE"})
    public ApiResponse get() {
        return ApiResponse.ok(view(AuthContext.get().orgId()));
    }

    @PutMapping("/api/org/as-services")
    @RequirePerm("ORG_WRITE")
    @Transactional
    public ApiResponse set(@RequestBody Map<String, Object> body) {
        CurrentUser me = AuthContext.get();
        if (!(body.get("asTypes") instanceof List<?> raw)) throw ApiException.badRequest("asTypes 목록이 필요합니다.");
        List<String> picked = raw.stream().map(String::valueOf).toList();
        for (String t : picked) if (!AsCodes.RCEPT_TYPES.contains(t)) throw ApiException.badRequest("알 수 없는 AS 서비스입니다: " + t);
        List<String> types = AsCodes.RCEPT_TYPES.stream().filter(picked::contains).toList();
        if (types.isEmpty()) throw ApiException.badRequest("AS 서비스를 하나 이상 선택해 주세요.");
        Org org = orgs.findById(me.orgId()).orElseThrow(() -> ApiException.notFound("기관을 찾을 수 없습니다."));
        org.asTypes = String.join(",", types);
        orgs.save(org);
        return ApiResponse.ok(view(org.orgId));
    }

    private Json view(Long orgId) {
        List<String> on = permissions.asTypes(orgId);
        List<Json> types = AsCodes.RCEPT_TYPES.stream()
                .map(t -> Json.obj().with("rceptTy", t).with("name", AsCodes.RCEPT_TY_NAME.get(t)).with("enabled", on.contains(t)))
                .toList();
        return Json.obj().with("asTypes", on).with("types", types);
    }
}
