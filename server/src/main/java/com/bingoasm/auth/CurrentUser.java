package com.bingoasm.auth;

import com.bingoasm.domain.AppUser;
import java.util.Set;

/** The authenticated caller, resolved once per request by {@link AuthInterceptor}. */
public record CurrentUser(AppUser user, Set<String> perms) {
    public Long userId() { return user.userId; }
    public Long orgId() { return user.orgId; }
    public boolean can(String perm) { return perms.contains(perm); }
    public boolean hasRole(String role) { return user.roles.contains(role); }
    /** 데이터 범위 (도교육청·교육지원청·학교·업체). 역할 우선순위는 {@link Scope#of}에서 한 번만 정한다. */
    public Scope scope() { return Scope.of(user); }
}
