package com.bingoasm.repo.as;
import com.bingoasm.domain.as.Contact;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface ContactRepository extends JpaRepository<Contact, Long> {
    List<Contact> findByOrgIdOrderBySortOrderAsc(Long orgId);
    void deleteByOrgId(Long orgId);
    void deleteByOrgIdAndRegionId(Long orgId, Long regionId);
    void deleteByOrgIdAndRegionIdIsNull(Long orgId);
}
