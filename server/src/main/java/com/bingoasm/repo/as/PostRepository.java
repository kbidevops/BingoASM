package com.bingoasm.repo.as;
import com.bingoasm.domain.as.Post;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
public interface PostRepository extends JpaRepository<Post, Long>, JpaSpecificationExecutor<Post> {
    List<Post> findByOrgIdAndBoardCodeAndUseYnOrderByPostIdDesc(Long orgId, String boardCode, String useYn);
}
