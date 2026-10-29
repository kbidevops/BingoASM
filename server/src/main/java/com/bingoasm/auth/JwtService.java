package com.bingoasm.auth;

import com.bingoasm.common.AppProperties;
import com.bingoasm.domain.AppUser;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Map;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Service;

/** HS384 JWT, same algorithm as the reference system. */
@Service
public class JwtService {
    private final SecretKey key;
    private final AppProperties props;
    private final PermissionService permissions;

    public JwtService(AppProperties props, PermissionService permissions) {
        this.props = props;
        this.permissions = permissions;
        if (props.jwtSecret().startsWith("change-me")) org.slf4j.LoggerFactory.getLogger(JwtService.class)
                .warn("JWT_SECRET is the development default. Set JWT_SECRET before exposing this server.");
        byte[] bytes = props.jwtSecret().getBytes(StandardCharsets.UTF_8);
        if (bytes.length < 48) throw new IllegalStateException("app.jwt-secret must be at least 48 bytes for HS384");
        this.key = Keys.hmacShaKeyFor(bytes);
    }

    public Map<String, String> issue(AppUser user) {
        Instant now = Instant.now();
        String access = Jwts.builder()
                .subject(String.valueOf(user.userId))
                .claim("orgId", user.orgId)
                .claim("loginId", user.loginId)
                .claim("perms", permissions.effectivePerms(user))
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(Duration.ofHours(props.accessTokenHours()))))
                .signWith(key, Jwts.SIG.HS384)
                .compact();
        String refresh = Jwts.builder()
                .subject(String.valueOf(user.userId))
                .claim("type", "refresh")
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(Duration.ofDays(props.refreshTokenDays()))))
                .signWith(key, Jwts.SIG.HS384)
                .compact();
        return Map.of("accessToken", access, "refreshToken", refresh);
    }

    /** Returns the claims, or throws if the token is invalid or expired. */
    public Claims parse(String token) {
        return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    }
}
