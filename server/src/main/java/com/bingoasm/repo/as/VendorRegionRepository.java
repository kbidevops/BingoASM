package com.bingoasm.repo.as;
import com.bingoasm.domain.as.VendorRegion;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface VendorRegionRepository extends JpaRepository<VendorRegion, Long> {
    List<VendorRegion> findByOrgIdOrderBySortOrderAsc(Long orgId);
    List<VendorRegion> findByVendorId(Long vendorId);
    List<VendorRegion> findByOrgIdAndRegionId(Long orgId, Long regionId);
}
