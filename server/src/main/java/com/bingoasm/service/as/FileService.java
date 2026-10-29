package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.StoredFile;
import com.bingoasm.repo.FileRepository;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/** 게시글·AS 신청·처리 보고서 첨부 파일. 저장 파일명은 무작위, 원본명은 DB에만. */
@Service
@Transactional
public class FileService {
    private static final long MAX_SIZE = 20L * 1024 * 1024;
    private static final Set<String> BLOCKED_EXT = Set.of("exe", "bat", "cmd", "com", "msi", "sh", "js", "jar", "vbs", "ps1", "scr", "php", "jsp", "html", "htm", "svg");
    private final FileRepository files;
    private final AppProperties props;

    public FileService(FileRepository files, AppProperties props) { this.files = files; this.props = props; }

    public Path uploadDir() { return Path.of(props.dataDir(), "uploads"); }

    public static Json view(StoredFile f) {
        return Json.obj().with("fileId", f.fileId).with("name", f.originalName).with("size", f.fileSize).with("mimeType", f.mimeType)
                .with("url", "/files/" + f.fileId + "/download");
    }

    public List<Json> upload(CurrentUser me, List<MultipartFile> parts) throws IOException {
        if (parts == null || parts.isEmpty()) throw ApiException.badRequest("파일을 선택해 주세요.");
        if (parts.size() > 5) throw ApiException.badRequest("한 번에 5개까지 올릴 수 있습니다.");
        Files.createDirectories(uploadDir());
        List<Json> out = new ArrayList<>();
        for (MultipartFile file : parts) {
            if (file.isEmpty()) continue;
            if (file.getSize() > MAX_SIZE) throw ApiException.badRequest("파일은 20MB 이하만 올릴 수 있습니다: " + file.getOriginalFilename());
            String original = Optional.ofNullable(file.getOriginalFilename()).orElse("file").replaceAll("[\\\\/\\r\\n\\t]", "_");
            String ext = original.contains(".") ? original.substring(original.lastIndexOf('.') + 1).toLowerCase() : "";
            if (BLOCKED_EXT.contains(ext)) throw ApiException.badRequest("허용되지 않는 파일 형식입니다: ." + ext);
            if (!ext.matches("[a-z0-9]{0,5}")) ext = "";
            String stored = System.currentTimeMillis() + "-" + UUID.randomUUID().toString().substring(0, 8) + (ext.isEmpty() ? "" : "." + ext);
            file.transferTo(uploadDir().resolve(stored).toAbsolutePath());
            StoredFile sf = new StoredFile();
            sf.storedName = stored; sf.originalName = original;
            sf.mimeType = Optional.ofNullable(file.getContentType()).orElse("application/octet-stream"); sf.fileSize = file.getSize(); sf.createdAt = Times.now();
            files.save(sf);
            out.add(view(sf));
        }
        if (out.isEmpty()) throw ApiException.badRequest("파일을 선택해 주세요.");
        return out;
    }

    @Transactional(readOnly = true)
    public Optional<StoredFile> find(Long id) { return files.findById(id); }

    public Path pathOf(StoredFile f) {
        Path p = uploadDir().resolve(f.storedName).normalize();
        if (!p.startsWith(uploadDir().normalize()) || !Files.exists(p)) return null;
        return p;
    }
}
