package com.bingoasm.repo;

import com.bingoasm.domain.Floor;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FloorRepository extends JpaRepository<Floor, Long> {
    List<Floor> findByBuildingIdInOrderBySortOrderAsc(Collection<Long> buildingIds);
    boolean existsByBuildingIdAndFloorNo(Long buildingId, Integer floorNo);
}
