package com.bingoasm.web.as;

import io.swagger.v3.oas.annotations.tags.Tag;
import com.bingoasm.auth.AuthContext;
import com.bingoasm.auth.PublicApi;
import com.bingoasm.auth.RequirePerm;
import com.bingoasm.common.ApiResponse;
import com.bingoasm.common.AppProperties;
import com.bingoasm.service.as.QrService;
import java.net.URI;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * QR: 자산 라벨·실 QR 이미지, 스캔 해석, 라벨 인쇄 데이터, 빈 라벨 번호 예약.
 * 라벨에 인쇄되는 주소(/a/{assetNo}, /r/{roomId})와 로그인 QR(/qr?t=)은 인증 없이 열리고 프런트 라우트로 넘긴다.
 */
@Tag(name = "QR", description = "자산·실 QR 이미지, 스캔 해석, 라벨 인쇄, 빈 라벨 번호 예약, 라벨 공개 링크")
@RestController
public class QrController {
    private final QrService qr;
    private final AppProperties props;

    public QrController(QrService qr, AppProperties props) { this.qr = qr; this.props = props; }

    private static ResponseEntity<byte[]> png(byte[] bytes) {
        return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).cacheControl(CacheControl.noCache()).body(bytes);
    }

    /** 자산 라벨 QR 이미지. 인증 필요(라벨 인쇄 화면의 <img>는 blob으로 받는다). */
    @GetMapping("/api/qr/asset/{assetNo}.png")
    @RequirePerm({"ASSET_READ", "INVENTORY"})
    public ResponseEntity<byte[]> assetPng(@PathVariable String assetNo, @RequestParam(required = false, defaultValue = "256") int size) {
        return png(qr.png(qr.assetQrText(assetNo.toUpperCase()), size));
    }

    @GetMapping("/api/qr/room/{roomId}.png")
    @RequirePerm({"FLOOR_READ", "SPACE_MANAGE", "INVENTORY"})
    public ResponseEntity<byte[]> roomPng(@PathVariable Long roomId, @RequestParam(required = false, defaultValue = "256") int size) {
        return png(qr.png(qr.roomQrText(roomId), size));
    }

    /** 카메라로 읽은 문자열이 무엇인지. body: { text } → type ASSET(REGISTERED/RESERVED/NOT_FOUND) | ROOM | LOGIN | UNKNOWN */
    @PostMapping("/api/qr/resolve")
    public ApiResponse resolve(@RequestBody Map<String, Object> body) {
        return ApiResponse.ok(qr.resolve(AuthContext.get(), String.valueOf(body.getOrDefault("text", ""))));
    }

    /** 자산번호로 조회(라벨 스캔 → 자산 화면). */
    @GetMapping("/api/assets/by-no/{assetNo}")
    @RequirePerm({"ASSET_READ", "INVENTORY"})
    public ApiResponse byNo(@PathVariable String assetNo) { return ApiResponse.ok(qr.byNo(AuthContext.get(), assetNo)); }

    /** 라벨 인쇄 항목. body: { assetIds:[...] | assetNos:[...] } */
    @PostMapping("/api/qr/labels")
    @RequirePerm({"ASSET_READ", "INVENTORY"})
    public ApiResponse labels(@RequestBody Map<String, Object> body) { return ApiResponse.ok(qr.labels(AuthContext.get(), body)); }

    /** 빈 라벨용 자산번호 예약. body: { count, year?, schoolId? } */
    @PostMapping("/api/qr/reserve")
    @RequirePerm("ASSET_WRITE")
    public ApiResponse reserve(@RequestBody Map<String, Object> body) { return ApiResponse.ok(qr.reserve(AuthContext.get(), body)); }

    // ----- 라벨에 인쇄된 공개 주소 → 프런트 라우트 -----

    @PublicApi
    @GetMapping("/a/{assetNo}")
    public ResponseEntity<Void> assetLink(@PathVariable String assetNo) {
        return redirect(props.assetLinkTemplate().replace("{assetNo}", assetNo.toUpperCase()));
    }

    @PublicApi
    @GetMapping("/r/{roomId}")
    public ResponseEntity<Void> roomLink(@PathVariable Long roomId) {
        return redirect(props.roomLinkTemplate().replace("{roomId}", String.valueOf(roomId)));
    }

    /** 로그인 QR(/qr?t=토큰): 승인 화면으로. */
    @PublicApi
    @GetMapping("/qr")
    public ResponseEntity<Void> loginLink(@RequestParam(required = false) String t) {
        return redirect("/login/qr-approve" + (t == null ? "" : "?t=" + t.replaceAll("[^A-Za-z0-9_-]", "")));
    }

    private static ResponseEntity<Void> redirect(String to) {
        String safe = to.replaceAll("[^A-Za-z0-9_\\-./?=&%]", "");
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(safe)).build();
    }
}
