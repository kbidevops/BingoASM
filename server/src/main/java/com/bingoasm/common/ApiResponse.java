package com.bingoasm.common;

import com.fasterxml.jackson.annotation.JsonInclude;

/** Response envelope shared by every API: { success, data } or { success: false, message }. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse(boolean success, Object data, String message) {
    public static ApiResponse ok(Object data) {
        return new ApiResponse(true, data, null);
    }

    public static ApiResponse fail(String message) {
        return new ApiResponse(false, null, message);
    }
}
