package com.bingoasm.seed;

import com.bingoasm.common.CryptoConverter;
import jakarta.persistence.EntityManager;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 암호화 이전에 저장된 이메일·휴대폰(평문)을 기동 시 한 번 암호화한다.
 * 엔티티로 읽으면 평문과 암호문을 구분할 수 없으므로 네이티브 SQL로 저장 형태를 직접 본다.
 */
@Component
@Order(3)
public class PiiMigration implements CommandLineRunner {
    private static final Logger log = LoggerFactory.getLogger(PiiMigration.class);
    private final EntityManager em;
    private final CryptoConverter crypto;

    public PiiMigration(EntityManager em, CryptoConverter crypto) { this.em = em; this.crypto = crypto; }

    @Override
    @Transactional
    public void run(String... args) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery(
                "select user_id, email, mobile from users where (email is not null and email not like 'enc:%') or (mobile is not null and mobile not like 'enc:%')")
                .getResultList();
        int n = 0;
        for (Object[] r : rows) {
            Long id = ((Number) r[0]).longValue();
            String email = (String) r[1], mobile = (String) r[2];
            em.createNativeQuery("update users set email = :e, mobile = :m where user_id = :id")
                    .setParameter("e", email == null ? null : crypto.convertToDatabaseColumn(email))
                    .setParameter("m", mobile == null ? null : crypto.convertToDatabaseColumn(mobile))
                    .setParameter("id", id).executeUpdate();
            n++;
        }
        if (n > 0) log.info("Encrypted personal data of {} existing user rows (key: {})", n, CryptoConverter.keySource());
    }
}
