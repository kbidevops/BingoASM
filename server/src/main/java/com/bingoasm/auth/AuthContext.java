package com.bingoasm.auth;

import com.bingoasm.common.ApiException;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

public final class AuthContext {
    static final String ATTR = "bingoasm.currentUser";

    private AuthContext() {}

    public static CurrentUser get() {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        Object u = attrs == null ? null : attrs.getAttribute(ATTR, RequestAttributes.SCOPE_REQUEST);
        if (u == null) throw ApiException.unauthorized("로그인이 필요합니다.");
        return (CurrentUser) u;
    }
}
