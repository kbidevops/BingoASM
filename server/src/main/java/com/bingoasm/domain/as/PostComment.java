package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "post_comments", indexes = @Index(columnList = "postId"))
public class PostComment {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long commentId;
    public Long postId;
    @Column(length = 4000, nullable = false)
    public String content;
    public Long authorUserId;
    @Column(length = 100)
    public String authorName;
    public LocalDateTime createdAt;
    @Column(length = 1)
    public String useYn = "Y";
}
