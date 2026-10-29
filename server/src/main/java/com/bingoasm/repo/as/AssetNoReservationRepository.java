package com.bingoasm.repo.as;
import com.bingoasm.domain.as.AssetNoReservation;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
public interface AssetNoReservationRepository extends JpaRepository<AssetNoReservation, Long> {
    Optional<AssetNoReservation> findByAssetNo(String assetNo);
    List<AssetNoReservation> findByOrgIdAndUsedAssetIdIsNullOrderByAssetNoAsc(Long orgId);
}
