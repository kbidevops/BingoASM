package com.bingoasm.repo;

import com.bingoasm.domain.Org;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrgRepository extends JpaRepository<Org, Long> {
    Optional<Org> findByOrgCode(String orgCode);
}
