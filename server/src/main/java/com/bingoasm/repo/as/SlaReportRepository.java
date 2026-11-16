package com.bingoasm.repo.as;

import com.bingoasm.domain.as.SlaReport;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SlaReportRepository extends JpaRepository<SlaReport, Long> {
    List<SlaReport> findByOrgIdOrderBySubmittedAtDescReportIdDesc(Long orgId);
}
