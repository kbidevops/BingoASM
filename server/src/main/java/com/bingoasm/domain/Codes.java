package com.bingoasm.domain;

import java.util.List;
import java.util.Map;
import java.util.Set;

/** Code values shared by services. */
public final class Codes {
    private Codes() {}

    public static final List<String> OPEN = List.of("REQUESTED", "RECEIVED", "ASSIGNED", "PROCESSING", "HOLD");
    public static final List<String> DONE = List.of("COMPLETED", "CLOSED");
    public static final Map<String, List<String>> STATUS_GROUPS = Map.of(
            "OPEN", OPEN,
            "WAITING", List.of("REQUESTED"),
            "IN_PROGRESS", List.of("RECEIVED", "ASSIGNED", "PROCESSING"),
            "DONE", DONE);
    /** DISPOSE_PLANNED = 불용예정 (내용연수 경과) */
    public static final Set<String> ASSET_STATUS = Set.of("INUSE", "IDLE", "REPAIR", "DISPOSE_PLANNED", "DISPOSED");
    public static final Set<String> USER_STATUS = Set.of("ACTIVE", "LOCKED", "DISABLED");
}
