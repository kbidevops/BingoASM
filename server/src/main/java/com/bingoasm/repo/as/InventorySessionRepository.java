package com.bingoasm.repo.as;
import com.bingoasm.domain.as.InventorySession;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface InventorySessionRepository extends JpaRepository<InventorySession, Long> {
    List<InventorySession> findBySchoolIdOrderByStartedAtDesc(Long schoolId);
}
