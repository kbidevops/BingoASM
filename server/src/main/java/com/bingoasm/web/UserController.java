package com.bingoasm.web;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.UserService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@Tag(name = "사용자(기존)", description = "사용자·역할 관리")
@RestController
public class UserController {
    private final UserService users;

    public UserController(UserService users) {
        this.users = users;
    }

    @GetMapping("/api/users")
    @RequirePerm("USER_READ")
    public ApiResponse list(@RequestParam(required = false) String keyword, @RequestParam(required = false) Long deptId,
                            @RequestParam(required = false) String role, @RequestParam(required = false) String status,
                            @RequestParam(required = false) Integer page, @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(users.list(AuthContext.get(), keyword, deptId, role, status, page, size));
    }

    @GetMapping("/api/users/processors")
    public ApiResponse processors() {
        return ApiResponse.ok(users.processors(AuthContext.get()));
    }

    @PostMapping("/api/users")
    @RequirePerm("USER_WRITE")
    public ApiResponse create(@RequestBody Map<String, Object> body) {
        return ApiResponse.ok(users.create(AuthContext.get(), body));
    }

    @PutMapping("/api/users/{id}")
    @RequirePerm("USER_WRITE")
    public ApiResponse update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return ApiResponse.ok(users.update(AuthContext.get(), id, body));
    }

    /** 삭제: 기록이 계정을 가리키므로 지우지 않고 사용 중지한다. */
    @DeleteMapping("/api/users/{id}")
    @RequirePerm("USER_WRITE")
    public ApiResponse delete(@PathVariable Long id) {
        users.delete(AuthContext.get(), id);
        return ApiResponse.ok(null);
    }

    /** 인증 앱(OTP) 등록 초기화: 휴대폰 분실·교체 때. 다음 로그인 때 새로 등록한다. */
    @PostMapping("/api/users/{id}/otp-reset")
    @RequirePerm("USER_WRITE")
    public ApiResponse resetOtp(@PathVariable Long id) {
        return ApiResponse.ok(users.resetOtp(AuthContext.get(), id));
    }

    /** 로그인 실패 잠금 해제. */
    @PostMapping("/api/users/{id}/unlock")
    @RequirePerm("USER_WRITE")
    public ApiResponse unlock(@PathVariable Long id) {
        return ApiResponse.ok(users.unlock(AuthContext.get(), id));
    }

    @PutMapping("/api/users/{id}/roles")
    @RequirePerm("ROLE_GRANT")
    public ApiResponse roles(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return ApiResponse.ok(users.roles(AuthContext.get(), id, body));
    }

    @GetMapping("/api/users/{id}/menu-perms")
    @RequirePerm("ROLE_GRANT")
    public ApiResponse menuPerms(@PathVariable Long id) {
        return ApiResponse.ok(users.menuPerms(AuthContext.get(), id));
    }

    @PutMapping("/api/users/{id}/menu-perms")
    @RequirePerm("ROLE_GRANT")
    public ApiResponse setMenuPerms(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return ApiResponse.ok(users.setMenuPerms(AuthContext.get(), id, body));
    }

    @GetMapping("/api/orgs")
    @RequirePerm("ORG_READ")
    public ApiResponse orgs() {
        return ApiResponse.ok(users.orgs(AuthContext.get()));
    }

    @GetMapping("/api/orgs/departments")
    public ApiResponse departments() {
        return ApiResponse.ok(users.departments(AuthContext.get()));
    }
}
