package com.bingoasm.repo.as;
import com.bingoasm.domain.as.QrLoginSession;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
public interface QrLoginSessionRepository extends JpaRepository<QrLoginSession, Long> {
    Optional<QrLoginSession> findByToken(String token);
}
