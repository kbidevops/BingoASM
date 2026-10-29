package com.bingoasm.repo.as;
import com.bingoasm.domain.as.InventoryScan;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface InventoryScanRepository extends JpaRepository<InventoryScan, Long> {
    List<InventoryScan> findBySessionIdOrderByScannedAtAsc(Long sessionId);
}
