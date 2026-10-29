package com.bingoasm.repo.as;
import com.bingoasm.domain.as.AsHistory;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface AsHistoryRepository extends JpaRepository<AsHistory, Long> {
    List<AsHistory> findByAsvcSnOrderByCreatedAtAscHistoryIdAsc(Long asvcSn);
}
