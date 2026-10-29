package com.bingoasm.auth;

import com.bingoasm.common.ApiException;
import com.bingoasm.domain.AppUser;
import com.bingoasm.repo.UserRepository;
import io.jsonwebtoken.Claims;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Arrays;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/** Validates the Bearer token and checks {@link RequirePerm} before every API handler. */
@Component
public class AuthInterceptor implements HandlerInterceptor {
    private final JwtService jwt;
    private final UserRepository users;
    private final PermissionService permissions;

    public AuthInterceptor(JwtService jwt, UserRepository users, PermissionService permissions) {
        this.jwt = jwt;
        this.users = users;
        this.permissions = permissions;
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
        if ("OPTIONS".equalsIgnoreCase(req.getMethod())) return true;  // CORS preflight
        if (!(handler instanceof HandlerMethod hm)) return true;
        if (hm.hasMethodAnnotation(PublicApi.class) || hm.getBeanType().isAnnotationPresent(PublicApi.class)) return true;

        String header = req.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) throw ApiException.unauthorized("로그인이 필요합니다.");
        AppUser user;
        try {
            Claims claims = jwt.parse(header.substring(7));
            if ("refresh".equals(claims.get("type"))) throw new IllegalArgumentException("refresh token");
            user = users.findById(Long.valueOf(claims.getSubject())).orElseThrow();
        } catch (Exception e) {
            throw ApiException.unauthorized("로그인이 필요합니다.");
        }
        if (!"ACTIVE".equals(user.status)) throw ApiException.unauthorized("사용할 수 없는 계정입니다.");

        Set<String> perms = permissions.effectivePerms(user);
        req.setAttribute(AuthContext.ATTR, new CurrentUser(user, perms));

        RequirePerm rp = hm.getMethodAnnotation(RequirePerm.class);
        if (rp == null) rp = hm.getBeanType().getAnnotation(RequirePerm.class);
        if (rp != null && Arrays.stream(rp.value()).noneMatch(perms::contains)) throw ApiException.forbidden("권한이 없습니다.");
        return true;
    }
}
