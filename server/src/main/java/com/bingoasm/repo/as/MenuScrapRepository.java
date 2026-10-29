package com.bingoasm.repo.as;
import com.bingoasm.domain.as.MenuScrap;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
public interface MenuScrapRepository extends JpaRepository<MenuScrap, Long> {
    List<MenuScrap> findByUserIdOrderByCreatedAtAsc(Long userId);
    Optional<MenuScrap> findByUserIdAndMenuKey(Long userId, String menuKey);
}
