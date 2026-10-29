package com.bingoasm.common;

import java.util.LinkedHashMap;

/** Ordered JSON object builder that skips null values (so absent fields are omitted like the reference API). */
public class Json extends LinkedHashMap<String, Object> {
    public static Json obj() {
        return new Json();
    }

    public Json with(String key, Object value) {
        if (value != null) put(key, value);
        return this;
    }
}
