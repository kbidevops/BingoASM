package com.bingoasm.repo.as;

import com.bingoasm.domain.as.WorkCalendarSetting;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkCalendarRepository extends JpaRepository<WorkCalendarSetting, Long> {}
