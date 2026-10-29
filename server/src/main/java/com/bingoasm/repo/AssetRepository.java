package com.bingoasm.repo;

import com.bingoasm.domain.Asset;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

public interface AssetRepository extends JpaRepository<Asset, Long>, JpaSpecificationExecutor<Asset> {
    List<Asset> findByOrgIdAndUseYn(Long orgId, String useYn);
    List<Asset> findByFloorIdAndUseYnAndPosXIsNotNull(Long floorId, String useYn);
    List<Asset> findByParentAssetIdAndUseYn(Long parentAssetId, String useYn);
    boolean existsByAssetNoAndUseYn(String assetNo, String useYn);
    long countByOrgIdAndUseYn(Long orgId, String useYn);
}
