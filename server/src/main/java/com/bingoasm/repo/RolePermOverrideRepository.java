package com.bingoasm.repo;

import com.bingoasm.domain.RolePermOverride;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RolePermOverrideRepository extends JpaRepository<RolePermOverride, Long> {
    List<RolePermOverride> findByOrgId(Long orgId);
}
