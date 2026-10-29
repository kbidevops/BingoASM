package com.bingoasm.repo;

import com.bingoasm.domain.ServiceRequest;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ServiceRequestRepository extends JpaRepository<ServiceRequest, Long>, JpaSpecificationExecutor<ServiceRequest> {
    List<ServiceRequest> findByOrgId(Long orgId);

    List<ServiceRequest> findByOrgIdAndRequestAtGreaterThanEqualAndRequestAtLessThan(Long orgId, LocalDateTime from, LocalDateTime to);

    /** Open service count per asset, for the asset list "진행 서비스" badge. */
    @Query("select s.assetId, count(s) from ServiceRequest s where s.orgId = :orgId and s.assetId is not null and s.status in :statuses group by s.assetId")
    List<Object[]> countByAssetAndStatus(@Param("orgId") Long orgId, @Param("statuses") Collection<String> statuses);
}
