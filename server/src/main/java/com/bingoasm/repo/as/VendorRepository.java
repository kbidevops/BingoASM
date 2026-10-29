package com.bingoasm.repo.as;
import com.bingoasm.domain.as.Vendor;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface VendorRepository extends JpaRepository<Vendor, Long> {
    List<Vendor> findByOrgIdAndUseYnOrderByVendorNameAsc(Long orgId, String useYn);
}
