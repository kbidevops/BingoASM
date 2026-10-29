package com.bingoasm.repo.as;
import com.bingoasm.domain.as.PostComment;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
public interface PostCommentRepository extends JpaRepository<PostComment, Long> {
    List<PostComment> findByPostIdAndUseYnOrderByCreatedAtAsc(Long postId, String useYn);
    @Query("select c.postId, count(c) from PostComment c where c.postId in :ids and c.useYn = 'Y' group by c.postId")
    List<Object[]> countByPostIds(@Param("ids") Collection<Long> ids);
}
