package com.bingoasm.common;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * Encrypts personal data (mobile, email) at rest with AES-256-GCM.
 * Stored form: "enc:" + base64(iv + ciphertext). Plain legacy values (without the prefix) are read as-is,
 * so existing rows keep working and are re-encrypted on their next save.
 */
@Converter
@Component
public class CryptoConverter implements AttributeConverter<String, String> {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(CryptoConverter.class);
    private static final String PREFIX = "enc:";
    /** Same default as application.yml; used only until Spring hands over the configured key. */
    static final String DEFAULT_KEY = "bingoasm-dev-data-key-change-me-0123456789";
    private static volatile byte[] key;
    private static volatile String keySource;

    static {
        // Hibernate may instantiate this converter through its own no-arg path before (or instead of) the Spring bean,
        // so the key must never depend on constructor injection having happened.
        String env = System.getProperty("DATA_KEY", System.getenv("DATA_KEY"));
        setKey(env == null || env.isBlank() ? DEFAULT_KEY : env, env == null || env.isBlank() ? "built-in default" : "DATA_KEY");
    }

    public CryptoConverter(AppProperties props) {
        if (props.dataKey() != null && !props.dataKey().isBlank()) setKey(props.dataKey(), "app.data-key");
    }

    /** No-arg constructor for JPA; the key comes from the static initializer / Spring. */
    public CryptoConverter() {}

    static synchronized void setKey(String secret, String source) {
        try {
            key = MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8));
            keySource = source;
            if (DEFAULT_KEY.equals(secret)) log.warn("DATA_KEY is the built-in default ({}): set DATA_KEY before production", source);
            else log.info("Personal-data encryption key loaded from {}", source);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static String keySource() { return keySource; }

    @Override
    public String convertToDatabaseColumn(String plain) {
        if (plain == null || plain.isEmpty()) return plain;
        if (plain.startsWith(PREFIX)) return plain; // already encrypted (re-save of a raw value)
        try {
            byte[] iv = new byte[12];
            new SecureRandom().nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return PREFIX + Base64.getEncoder().encodeToString(out);
        } catch (Exception e) {
            throw new IllegalStateException("encrypt failed", e);
        }
    }

    @Override
    public String convertToEntityAttribute(String db) {
        if (db == null || !db.startsWith(PREFIX)) return db;
        try {
            byte[] in = Base64.getDecoder().decode(db.substring(PREFIX.length()));
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, in, 0, 12));
            return new String(c.doFinal(in, 12, in.length - 12), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("decrypt failed (wrong DATA_KEY?)", e);
        }
    }
}
