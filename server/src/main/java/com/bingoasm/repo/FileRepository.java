package com.bingoasm.repo;

import com.bingoasm.domain.StoredFile;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FileRepository extends JpaRepository<StoredFile, Long> {
}
