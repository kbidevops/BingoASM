package com.bingoasm.repo;

import com.bingoasm.domain.Building;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BuildingRepository extends JpaRepository<Building, Long> {
    List<Building> findByOrgIdAndUseYn(Long orgId, String useYn);
    List<Building> findByOrgId(Long orgId);
}
