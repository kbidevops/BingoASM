package com.bingoasm.repo.as;
import com.bingoasm.domain.as.Region;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface RegionRepository extends JpaRepository<Region, Long> {
    List<Region> findByOrgIdOrderBySortOrderAsc(Long orgId);
}
