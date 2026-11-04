package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.common.Json;
import com.bingoasm.service.as.NotificationService;
import org.springframework.web.bind.annotation.*;

/** 내 알림 (머리글의 종). 로그인한 사용자 누구나, 자기 알림만. */
@Tag(name = "알림", description = "AS 처리 단계가 바뀔 때 관계자에게 남는 시스템 안 알림")
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    private final NotificationService notifications;

    public NotificationController(NotificationService notifications) { this.notifications = notifications; }

    /** 최근 알림. unread=true면 안 읽은 것만. 응답: { list: Page, unreadCount } */
    @GetMapping
    public ApiResponse list(@RequestParam(required = false) Boolean unread, @RequestParam(required = false) Integer page,
                            @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(notifications.list(AuthContext.get(), Boolean.TRUE.equals(unread), page, size));
    }

    @GetMapping("/unread-count")
    public ApiResponse unreadCount() { return ApiResponse.ok(Json.obj().with("count", notifications.unreadCount(AuthContext.get()))); }

    @PostMapping("/{id}/read")
    public ApiResponse read(@PathVariable Long id) { notifications.read(AuthContext.get(), id); return ApiResponse.ok(null); }

    @PostMapping("/read-all")
    public ApiResponse readAll() { return ApiResponse.ok(Json.obj().with("count", notifications.readAll(AuthContext.get()))); }
}
