package com.bingoasm.repo;

import com.bingoasm.domain.Category;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CategoryRepository extends JpaRepository<Category, Long> {
    List<Category> findByUseYnOrderBySortOrderAsc(String useYn);
}
