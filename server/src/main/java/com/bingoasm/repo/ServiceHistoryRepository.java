package com.bingoasm.repo;

import com.bingoasm.domain.ServiceHistory;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ServiceHistoryRepository extends JpaRepository<ServiceHistory, Long> {
    List<ServiceHistory> findByRequestIdOrderByCreatedAtAscHistoryIdAsc(Long requestId);
}
