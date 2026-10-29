package com.bingoasm.repo.as;
import com.bingoasm.domain.as.LoginHistory;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface LoginHistoryRepository extends JpaRepository<LoginHistory, Long> {
    List<LoginHistory> findTop5ByUserIdOrderByLoginAtDesc(Long userId);
}
