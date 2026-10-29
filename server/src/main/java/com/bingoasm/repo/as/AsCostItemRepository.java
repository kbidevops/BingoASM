package com.bingoasm.repo.as;
import com.bingoasm.domain.as.AsCostItem;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface AsCostItemRepository extends JpaRepository<AsCostItem, Long> {
    List<AsCostItem> findByAsvcSnOrderBySortOrderAsc(Long asvcSn);
    List<AsCostItem> findByAsvcSnIn(Collection<Long> asvcSns);
    void deleteByAsvcSn(Long asvcSn);
}
