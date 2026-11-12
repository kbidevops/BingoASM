package com.bingoasm.repo.as;

import com.bingoasm.domain.as.AsAlertRule;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AsAlertRuleRepository extends JpaRepository<AsAlertRule, Long> {
    List<AsAlertRule> findByOrgId(Long orgId);
}
