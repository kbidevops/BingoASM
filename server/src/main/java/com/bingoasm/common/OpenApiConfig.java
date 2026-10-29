package com.bingoasm.common;

import com.bingoasm.auth.PublicApi;
import com.bingoasm.auth.RequirePerm;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import java.util.List;
import org.springdoc.core.customizers.GlobalOperationCustomizer;
import org.springdoc.core.models.GroupedOpenApi;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Swagger UI(/swagger-ui.html)와 OpenAPI 문서(/v3/api-docs)를 자동 생성한다.
 * 컨트롤러의 Javadoc이 설명으로 들어가고, {@link RequirePerm}/{@link PublicApi}가 각 API의 권한 안내로 붙는다.
 */
@Configuration
public class OpenApiConfig {
    private static final String BEARER = "bearerAuth";

    @Bean
    public OpenAPI bingoAsmOpenApi() {
        String description = """
                BingoASM 자산·AS 관리 서버와 **원클릭 AS 모듈**(충북교육청 원클릭 AS 역설계)의 REST API입니다.

                **사용 방법**
                1. `인증 > POST /api/auth/login`을 실행해 `accessToken`을 받습니다 (OTP 사용자는 `otpToken`+`devCode`로 `/otp/verify`).
                2. 오른쪽 위 **Authorize**에 토큰을 붙여 넣으면 이후 모든 호출에 `Authorization: Bearer` 헤더가 붙습니다.
                3. 각 API 설명 끝의 **권한** 줄에 필요한 권한 코드가 있습니다. 내 권한은 `GET /api/auth/me`의 `permissions`로 확인합니다.

                **응답 형식** — 성공 `{ "success": true, "data": ... }`, 실패 `{ "success": false, "message": "..." }` + HTTP 상태
                (400 입력 오류 · 401 미로그인 · 403 권한 없음 · 404 없음 · 409 상태 충돌 · 423 계정 잠김 · 429 요청 과다).
                목록은 `page`(1부터)·`size`(기본 20) → `{ content, totalElements, page, size, totalPages }`.

                **데모 계정** (비밀번호 `user1234!`, admin은 `admin1234!`): `school01` 학교 담당자 · `netengineer` 무선망·스쿨넷 기사 ·
                `vendoradmin` 업체 관리자 · `eduadmin` 교육청 관리자(OTP) · `admin` 시스템 관리자.
                """;
        return new OpenAPI()
                .info(new Info().title("BingoASM · 원클릭 AS API").version("1.0.0").description(description)
                        .contact(new Contact().name("BingoASM 백엔드")))
                .components(new Components().addSecuritySchemes(BEARER, new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")
                        .description("POST /api/auth/login 응답의 accessToken")))
                .addSecurityItem(new SecurityRequirement().addList(BEARER));
    }

    @Bean
    public GroupedOpenApi authGroup() {
        return GroupedOpenApi.builder().group("1. 인증").pathsToMatch("/api/auth/**", "/qr").build();
    }

    @Bean
    public GroupedOpenApi oneClickAsGroup() {
        return GroupedOpenApi.builder().group("2. 원클릭 AS")
                .pathsToMatch("/api/as/**", "/api/qr/**", "/api/assets/bulk/**", "/api/assets/by-no/**", "/api/files/**", "/files/*/download", "/a/**", "/r/**")
                .build();
    }

    @Bean
    public GroupedOpenApi assetGroup() {
        return GroupedOpenApi.builder().group("3. 자산·서비스(기존)")
                .pathsToMatch("/api/assets/**", "/api/places/**", "/api/services/**", "/api/stats/**", "/api/users/**", "/files/*")
                .pathsToExclude("/api/assets/bulk/**", "/api/assets/by-no/**", "/files/*/download")
                .build();
    }

    @Bean
    public GroupedOpenApi allGroup() {
        return GroupedOpenApi.builder().group("0. 전체").pathsToMatch("/**").build();
    }

    /** 각 API 설명 끝에 필요한 권한을 붙이고, 공개 API는 자물쇠를 뗀다. */
    @Bean
    public GlobalOperationCustomizer permissionNotes() {
        return (operation, handlerMethod) -> {
            boolean isPublic = handlerMethod.hasMethodAnnotation(PublicApi.class) || handlerMethod.getBeanType().isAnnotationPresent(PublicApi.class);
            RequirePerm rp = handlerMethod.getMethodAnnotation(RequirePerm.class);
            if (rp == null) rp = handlerMethod.getBeanType().getAnnotation(RequirePerm.class);
            String base = operation.getDescription() == null ? "" : operation.getDescription().trim();
            String note;
            if (isPublic) {
                note = "**권한:** 공개 (로그인 불필요)";
                operation.setSecurity(List.of());
            } else if (rp != null) {
                note = "**권한:** " + String.join(" 또는 ", rp.value()) + (rp.value().length > 1 ? " 중 하나" : "");
            } else {
                note = "**권한:** 로그인 필요 (세부 권한·데이터 범위는 서비스에서 검사)";
            }
            operation.setDescription(base.isEmpty() ? note : base + "\n\n" + note);
            return operation;
        };
    }
}
