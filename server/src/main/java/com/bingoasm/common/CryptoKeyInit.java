package com.bingoasm.common;

import org.springframework.stereotype.Component;

/**
 * Hands the configured app.data-key to {@link CryptoConverter}. Hibernate instantiates the converter itself
 * (no-arg), so the converter's own Spring constructor is not guaranteed to run; this bean always is.
 */
@Component
public class CryptoKeyInit {
    public CryptoKeyInit(AppProperties props) {
        if (props.dataKey() != null && !props.dataKey().isBlank()) CryptoConverter.setKey(props.dataKey(), "app.data-key");
    }
}
