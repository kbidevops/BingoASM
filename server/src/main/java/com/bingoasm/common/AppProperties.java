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
        int qrLoginSeconds,
        String qrBaseUrl,
        String assetLinkTemplate,
        String deviceLinkTemplate,
        String corsOrigins,
        String defaultAsTypes,
        String siteOrgCode,
        boolean contactsSample) {
}
