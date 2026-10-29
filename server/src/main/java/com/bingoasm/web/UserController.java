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
    @RequirePerm({"USER_READ", "ASSET_WRITE"})
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
