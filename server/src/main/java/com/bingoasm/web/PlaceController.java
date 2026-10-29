package com.bingoasm.web;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.PublicApi;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.domain.StoredFile;
import com.bingoasm.repo.FileRepository;
import com.bingoasm.service.PlaceService;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@Tag(name = "건물·층·도면(기존)", description = "건물·층 관리, 도면 이미지 업로드와 조회")
@RestController
public class PlaceController {
    private final PlaceService places;
    private final FileRepository files;

    public PlaceController(PlaceService places, FileRepository files) {
        this.places = places;
        this.files = files;
    }

    @GetMapping("/api/places/buildings")
    public ApiResponse buildings() {
        return ApiResponse.ok(places.buildings(AuthContext.get()));
    }

    @PostMapping("/api/places/buildings")
    @RequirePerm({"FLOOR_WRITE", "ORG_WRITE"})
    public ApiResponse createBuilding(@RequestBody Map<String, Object> body) {
        return ApiResponse.ok(places.createBuilding(AuthContext.get(), body));
    }

    @PostMapping("/api/places/floors")
    @RequirePerm({"ORG_WRITE", "ROLE_GRANT", "FLOOR_WRITE"})
    public ApiResponse createFloor(@RequestBody Map<String, Object> body) {
        return ApiResponse.ok(places.createFloor(AuthContext.get(), body));
    }

    @GetMapping("/api/places/floors/{id}")
    public ApiResponse floor(@PathVariable Long id) {
        return ApiResponse.ok(places.floorDetail(AuthContext.get(), id));
    }

    @PostMapping(value = "/api/places/floors/{id}/plan", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @RequirePerm("FLOOR_WRITE")
    public ApiResponse uploadPlan(@PathVariable Long id, @RequestParam(value = "file", required = false) MultipartFile file) throws IOException {
        return ApiResponse.ok(places.uploadPlan(AuthContext.get(), id, file));
    }

    /** Floor plan image. Public by id so <img src> works without an auth header. */
    @PublicApi
    @GetMapping("/files/{id}")
    public ResponseEntity<Resource> file(@PathVariable Long id) {
        StoredFile f = files.findById(id).orElse(null);
        if (f == null) return ResponseEntity.notFound().build();
        Path p = places.uploadDir().resolve(f.storedName).normalize();
        if (!p.startsWith(places.uploadDir().normalize()) || !Files.exists(p)) return ResponseEntity.notFound().build();
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(f.mimeType))
                .cacheControl(CacheControl.noCache())
                .header("X-Content-Type-Options", "nosniff")
                .body(new FileSystemResource(p));
    }
}
