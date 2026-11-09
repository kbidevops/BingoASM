package com.bingoasm.repo.as;

import com.bingoasm.domain.as.DeviceHistory;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DeviceHistoryRepository extends JpaRepository<DeviceHistory, Long> {
    List<DeviceHistory> findByDeviceIdOrderByHistoryIdDesc(Long deviceId);
}
