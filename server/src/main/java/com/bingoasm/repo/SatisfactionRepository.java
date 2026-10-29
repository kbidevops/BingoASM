package com.bingoasm.repo;

import com.bingoasm.domain.Satisfaction;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SatisfactionRepository extends JpaRepository<Satisfaction, Long> {
    Optional<Satisfaction> findByRequestId(Long requestId);
    List<Satisfaction> findByRequestIdIn(Collection<Long> requestIds);
}
