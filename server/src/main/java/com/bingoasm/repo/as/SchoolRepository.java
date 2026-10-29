package com.bingoasm.repo.as;
import com.bingoasm.domain.as.School;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface SchoolRepository extends JpaRepository<School, Long> {
    List<School> findByOrgIdAndUseYnOrderBySchoolNameAsc(Long orgId, String useYn);
    long countByOrgIdAndUseYn(Long orgId, String useYn);
}
