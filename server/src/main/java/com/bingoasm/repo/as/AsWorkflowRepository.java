package com.bingoasm.repo.as;

import com.bingoasm.domain.as.AsWorkflow;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AsWorkflowRepository extends JpaRepository<AsWorkflow, Long> {
    List<AsWorkflow> findByOrgId(Long orgId);
}
