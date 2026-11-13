package com.bingoasm.repo.as;

import com.bingoasm.domain.as.AsHandover;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AsHandoverRepository extends JpaRepository<AsHandover, Long> {
    Optional<AsHandover> findFirstByAsvcSnAndEndAtIsNullOrderByHandoverIdDesc(Long asvcSn);
    List<AsHandover> findByAsvcSnInOrderByStartAtAsc(Collection<Long> asvcSns);
}
