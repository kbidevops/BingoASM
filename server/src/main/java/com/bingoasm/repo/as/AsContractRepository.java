package com.bingoasm.repo.as;
import com.bingoasm.domain.as.AsContract;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface AsContractRepository extends JpaRepository<AsContract, Long> {
    List<AsContract> findByOrgIdAndUseYnOrderByStartDateDescContractIdDesc(Long orgId, String useYn);
}
