package com.bingoasm.repo.as;
import com.bingoasm.domain.as.AsBudget;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface AsBudgetRepository extends JpaRepository<AsBudget, Long> {
    List<AsBudget> findByOrgIdAndBudgetYear(Long orgId, Integer budgetYear);
}
