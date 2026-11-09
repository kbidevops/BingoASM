package com.bingoasm.common;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Google OTP(구글 OTP)·Microsoft Authenticator 등 인증 앱의 6자리 번호 (TOTP, RFC 6238: HMAC-SHA1, 30초, 6자리).
 * 서버와 휴대폰이 같은 비밀값과 현재 시각으로 같은 번호를 계산하므로 문자·인터넷 없이 동작한다.
 */
public final class Totp {
    private Totp() {}

    public static final int PERIOD = 30;
    /** 앞뒤 한 칸(±30초)까지 받아 준다: 휴대폰·서버 시계가 조금 어긋나도 된다. */
    private static final int WINDOW = 1;
    private static final String B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final SecureRandom RND = new SecureRandom();

    /** 새 비밀값: 160비트, Base32 (인증 앱이 읽는 형식). */
    public static String newSecret() {
        byte[] b = new byte[20];
        RND.nextBytes(b);
        StringBuilder sb = new StringBuilder();
        int buf = 0, bits = 0;
        for (byte x : b) {
            buf = (buf << 8) | (x & 0xff);
            bits += 8;
            while (bits >= 5) { sb.append(B32.charAt((buf >> (bits - 5)) & 31)); bits -= 5; }
        }
        if (bits > 0) sb.append(B32.charAt((buf << (5 - bits)) & 31));
        return sb.toString();
    }

    /** 인증 앱이 QR로 읽는 등록 주소. issuer·account는 앱 목록에 보이는 이름이다. */
    public static String uri(String issuer, String account, String secret) {
        String i = enc(issuer), a = enc(account);
        return "otpauth://totp/" + i + ":" + a + "?secret=" + secret + "&issuer=" + i + "&algorithm=SHA1&digits=6&period=" + PERIOD;
    }

    /** 사람이 옮겨 적기 쉽게 네 글자씩 띄운 비밀값. */
    public static String grouped(String secret) {
        return secret.replaceAll("(.{4})(?=.)", "$1 ");
    }

    public static long currentStep() { return System.currentTimeMillis() / 1000 / PERIOD; }

    /**
     * 번호가 맞으면 그 번호의 시간 칸(step)을, 틀리면 -1. afterStep 이하의 칸은 받지 않는다 —
     * 한 번 쓴 번호(같은 30초 안에 다시 입력, 어깨너머로 본 번호)를 막는다.
     */
    public static long verify(String secret, String code, Long afterStep) {
        if (secret == null || code == null || !code.matches("\\d{6}")) return -1;
        byte[] key = decode(secret);
        long now = currentStep();
        for (long s = now - WINDOW; s <= now + WINDOW; s++) {
            if (afterStep != null && s <= afterStep) continue;
            if (code(key, s).equals(code)) return s;
        }
        return -1;
    }

    static String code(byte[] key, long step) {
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(key, "HmacSHA1"));
            byte[] h = mac.doFinal(java.nio.ByteBuffer.allocate(8).putLong(step).array());
            int o = h[h.length - 1] & 0xf;
            int n = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
            return String.format("%06d", n % 1_000_000);
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    static byte[] decode(String s) {
        String t = s.replace(" ", "").replace("=", "").toUpperCase();
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        int buf = 0, bits = 0;
        for (char c : t.toCharArray()) {
            int v = B32.indexOf(c);
            if (v < 0) throw new IllegalArgumentException("bad base32");
            buf = (buf << 5) | v;
            bits += 5;
            if (bits >= 8) { out.write((buf >> (bits - 8)) & 0xff); bits -= 8; }
        }
        return out.toByteArray();
    }

    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20"); }
}
