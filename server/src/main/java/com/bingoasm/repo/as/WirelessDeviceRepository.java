package com.bingoasm.repo.as;
import com.bingoasm.domain.as.WirelessDevice;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface WirelessDeviceRepository extends JpaRepository<WirelessDevice, Long> {
    List<WirelessDevice> findByOrgIdAndUseYnOrderBySchoolIdAscDeviceCodeAsc(Long orgId, String useYn);
    List<WirelessDevice> findBySchoolIdAndUseYnOrderByDeviceCodeAsc(Long schoolId, String useYn);
}
