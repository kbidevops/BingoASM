package com.bingoasm.repo;

import com.bingoasm.domain.AppUser;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<AppUser, Long> {
    Optional<AppUser> findByLoginId(String loginId);
    Optional<AppUser> findByLoginIdAndOrgId(String loginId, Long orgId);
    List<AppUser> findByOrgIdOrderByUserIdAsc(Long orgId);
    long countByOrgId(Long orgId);
}
