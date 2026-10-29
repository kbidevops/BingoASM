package com.bingoasm.repo.as;
import com.bingoasm.domain.as.SchoolVendor;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
public interface SchoolVendorRepository extends JpaRepository<SchoolVendor, Long> {
    List<SchoolVendor> findBySchoolId(Long schoolId);
    List<SchoolVendor> findBySchoolIdIn(Collection<Long> schoolIds);
    Optional<SchoolVendor> findBySchoolIdAndRceptTy(Long schoolId, String rceptTy);
    void deleteBySchoolId(Long schoolId);
}
