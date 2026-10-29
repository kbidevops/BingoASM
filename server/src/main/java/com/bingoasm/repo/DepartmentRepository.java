package com.bingoasm.repo;

import com.bingoasm.domain.Department;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DepartmentRepository extends JpaRepository<Department, Long> {
    List<Department> findByOrgIdAndUseYnOrderBySortOrderAsc(Long orgId, String useYn);
    List<Department> findByOrgId(Long orgId);
}
