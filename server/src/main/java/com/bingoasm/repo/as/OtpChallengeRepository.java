package com.bingoasm.repo.as;
import com.bingoasm.domain.as.OtpChallenge;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
public interface OtpChallengeRepository extends JpaRepository<OtpChallenge, Long> {
    Optional<OtpChallenge> findByToken(String token);
}
