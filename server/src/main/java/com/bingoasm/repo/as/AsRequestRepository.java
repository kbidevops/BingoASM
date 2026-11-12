package com.bingoasm.repo.as;
import com.bingoasm.domain.as.AsRequest;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
public interface AsRequestRepository extends JpaRepository<AsRequest, Long>, JpaSpecificationExecutor<AsRequest> {
    List<AsRequest> findByOrgIdAndUseYn(Long orgId, String useYn);
    List<AsRequest> findByOrgIdAndUseYnAndStatusIn(Long orgId, String useYn, List<String> status);
    List<AsRequest> findByDeviceIdAndUseYnAndStatusIn(Long deviceId, String useYn, List<String> status);
    long countByVendorIdAndUseYn(Long vendorId, String useYn);
    long countByEngineerUserIdAndUseYnAndStatusIn(Long engineerUserId, String useYn, List<String> status);
    long countByVendorIdAndUseYnAndStatusIn(Long vendorId, String useYn, List<String> status);
    List<AsRequest> findByVendorIdAndUseYnAndStatusInOrderByRequestAtAsc(Long vendorId, String useYn, List<String> status);
    long countByOrgIdAndRceptTyAndUseYnAndStatusIn(Long orgId, String rceptTy, String useYn, List<String> status);
    List<AsRequest> findByOrgIdAndUseYnAndRequestAtGreaterThanEqualAndRequestAtLessThan(Long orgId, String useYn, LocalDateTime from, LocalDateTime to);
}
