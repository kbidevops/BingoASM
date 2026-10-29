package com.bingoasm.common;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public record AppProperties(
        String dataDir,
        String jwtSecret,
        int accessTokenHours,
        int refreshTokenDays,
        int maxLoginFail,
        int lockMinutes,
        String clientDist,
        String dataKey,
        boolean otpDevEcho,
        int qrLoginSeconds,
        String qrBaseUrl,
        String assetLinkTemplate,
        String roomLinkTemplate,
        String corsOrigins) {
}
