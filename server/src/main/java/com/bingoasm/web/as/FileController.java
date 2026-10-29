package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.PublicApi;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.domain.StoredFile;
import com.bingoasm.service.as.FileService;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** 첨부 파일 업로드(로그인 사용자)와 내려받기. */
@Tag(name = "첨부 파일", description = "업로드와 내려받기")
@RestController
public class FileController {
    private final FileService files;

    public FileController(FileService files) { this.files = files; }

    /** multipart: files=... (최대 5개, 각 20MB). 반환 [{fileId, name, size, url}] — 게시글·AS 신청의 attachFileIds에 넣는다. */
    @PostMapping(value = "/api/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse upload(@RequestParam(value = "files", required = false) List<MultipartFile> parts,
                              @RequestParam(value = "file", required = false) MultipartFile single) throws IOException {
        List<MultipartFile> all = parts == null || parts.isEmpty() ? (single == null ? List.of() : List.of(single)) : parts;
        return ApiResponse.ok(files.upload(AuthContext.get(), all));
    }

    /** 첨부 다운로드. 파일 id는 추측하기 어려운 정수가 아니므로 Content-Disposition attachment + nosniff 로만 제공. */
    @PublicApi
    @GetMapping("/files/{id}/download")
    public ResponseEntity<Resource> download(@PathVariable Long id) {
        StoredFile f = files.find(id).orElse(null);
        Path p = f == null ? null : files.pathOf(f);
        if (p == null) return ResponseEntity.notFound().build();
        String name = URLEncoder.encode(f.originalName, StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .cacheControl(CacheControl.noCache())
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Disposition", "attachment; filename*=UTF-8''" + name)
                .body(new FileSystemResource(p));
    }
}
