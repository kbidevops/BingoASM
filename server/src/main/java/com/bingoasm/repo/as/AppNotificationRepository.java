package com.bingoasm.repo.as;
import com.bingoasm.domain.as.AppNotification;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
public interface AppNotificationRepository extends JpaRepository<AppNotification, Long> {
    Page<AppNotification> findByUserIdOrderByCreatedAtDescNotificationIdDesc(Long userId, Pageable page);
    Page<AppNotification> findByUserIdAndReadAtIsNullOrderByCreatedAtDescNotificationIdDesc(Long userId, Pageable page);
    long countByUserIdAndReadAtIsNull(Long userId);
    List<AppNotification> findByUserIdAndReadAtIsNull(Long userId);
    @Modifying
    @Query("delete from AppNotification n where n.createdAt < :before")
    int deleteOlderThan(LocalDateTime before);
}
