package com.bingoasm.repo.as;
import com.bingoasm.domain.as.AsRequest;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
public interface AsRequestRepository extends JpaRepository<AsRequest, Long>, JpaSpecificationExecutor<AsRequest> {
    List<AsRequest> findByOrgIdAndUseYn(Long orgId, String useYn);
    List<AsRequest> findByOrgIdAndUseYnAndRequestAtGreaterThanEqualAndRequestAtLessThan(Long orgId, String useYn, LocalDateTime from, LocalDateTime to);
}
