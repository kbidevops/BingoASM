package com.bingoasm.repo.as;

import com.bingoasm.domain.as.Holiday;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HolidayRepository extends JpaRepository<Holiday, Long> {
    List<Holiday> findByOrgIdOrderByHolidayDateAsc(Long orgId);
}
