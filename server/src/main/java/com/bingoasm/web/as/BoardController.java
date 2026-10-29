package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.service.as.BoardService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/**
 * 게시판: NOTICE 공지및자료실 · QNA 질문및건의 · CONSULT 컨설팅신청 · DISPOSAL 불용PC수거신청 · VENDOR 유지관리업체(정보공유) · SLA 스쿨넷SLA공유.
 * 읽기·쓰기 권한은 AsCodes.BOARDS 설정에 따라 서비스가 검사한다.
 */
@Tag(name = "게시판", description = "공지(NOTICE) · 질문및건의(QNA) · 컨설팅(CONSULT) · 불용PC수거(DISPOSAL) · 업체정보공유(VENDOR) · 스쿨넷 SLA(SLA)")
@RestController
@RequestMapping("/api/as/boards")
public class BoardController {
    private final BoardService boards;

    public BoardController(BoardService boards) { this.boards = boards; }

    /** 내가 볼 수 있는 게시판 목록(메뉴 구성용). */
    @GetMapping
    public ApiResponse boards() { return ApiResponse.ok(boards.boards(AuthContext.get())); }

    @GetMapping("/{code}")
    public ApiResponse list(@PathVariable String code, @RequestParam(required = false) String keyword, @RequestParam(required = false) String searchType,
                            @RequestParam(required = false) Long regionId, @RequestParam(required = false) String fieldCode,
                            @RequestParam(required = false) String categoryCode, @RequestParam(required = false) String status,
                            @RequestParam(required = false) Boolean mine,
                            @RequestParam(required = false) Integer page, @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(boards.list(AuthContext.get(), code.toUpperCase(),
                new BoardService.Filter(keyword, searchType, regionId, fieldCode, categoryCode, status, Boolean.TRUE.equals(mine)), page, size));
    }

    @GetMapping("/{code}/{id}")
    public ApiResponse detail(@PathVariable String code, @PathVariable Long id) { return ApiResponse.ok(boards.detail(AuthContext.get(), code.toUpperCase(), id)); }

    @PostMapping("/{code}")
    public ApiResponse create(@PathVariable String code, @RequestBody Map<String, Object> body) {
        Long id = boards.create(AuthContext.get(), code.toUpperCase(), body);
        return ApiResponse.ok(boards.detail(AuthContext.get(), code.toUpperCase(), id));
    }

    @PutMapping("/{code}/{id}")
    public ApiResponse update(@PathVariable String code, @PathVariable Long id, @RequestBody Map<String, Object> body) {
        boards.update(AuthContext.get(), code.toUpperCase(), id, body);
        return ApiResponse.ok(boards.detail(AuthContext.get(), code.toUpperCase(), id));
    }

    @DeleteMapping("/{code}/{id}")
    public ApiResponse delete(@PathVariable String code, @PathVariable Long id) { boards.delete(AuthContext.get(), code.toUpperCase(), id); return ApiResponse.ok(null); }

    /** 컨설팅·불용PC수거 진행상태(WAIT/RECEIVED/DONE) — 관리자. body: { status, visitDate? } */
    @PatchMapping("/{code}/{id}/status")
    public ApiResponse status(@PathVariable String code, @PathVariable Long id, @RequestBody Map<String, Object> body) {
        boards.setStatus(AuthContext.get(), code.toUpperCase(), id, body);
        return ApiResponse.ok(boards.detail(AuthContext.get(), code.toUpperCase(), id));
    }

    /** 답변·댓글. body: { content } */
    @PostMapping("/{code}/{id}/comments")
    public ApiResponse comment(@PathVariable String code, @PathVariable Long id, @RequestBody Map<String, Object> body) {
        boards.addComment(AuthContext.get(), code.toUpperCase(), id, body);
        return ApiResponse.ok(boards.detail(AuthContext.get(), code.toUpperCase(), id));
    }

    @DeleteMapping("/{code}/{id}/comments/{commentId}")
    public ApiResponse deleteComment(@PathVariable String code, @PathVariable Long id, @PathVariable Long commentId) {
        boards.deleteComment(AuthContext.get(), code.toUpperCase(), id, commentId);
        return ApiResponse.ok(boards.detail(AuthContext.get(), code.toUpperCase(), id));
    }
}
