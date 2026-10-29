package com.bingoasm.repo;

import com.bingoasm.domain.AssetHistory;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AssetHistoryRepository extends JpaRepository<AssetHistory, Long> {
    List<AssetHistory> findByAssetIdOrderByCreatedAtDescHistoryIdDesc(Long assetId);
}
