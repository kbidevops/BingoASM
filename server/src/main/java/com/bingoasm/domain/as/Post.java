package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;

/** 게시글. boardCode: NOTICE QNA CONSULT DISPOSAL VENDOR SLA */
@Entity
@Table(name = "posts", indexes = {@Index(columnList = "orgId"), @Index(columnList = "boardCode")})
public class Post {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long postId;
    public Long orgId;
    @Column(length = 20, nullable = false)
    public String boardCode;
    @Column(length = 200, nullable = false)
    public String title;
    @Column(length = 8000)
    public String content;
    public Long authorUserId;
    @Column(length = 100)
    public String authorName;
    /** 유형: 일반/긴급/자료, 질문/건의, 의견사항/업무질의 */
    @Column(length = 20)
    public String categoryCode;
    /** 분야: WIRELESS 무선, DEVICE 정보기기, SCHOOLNET 스쿨넷, ETC */
    @Column(length = 20)
    public String fieldCode;
    public Long regionId;
    public Long schoolId;
    /** 진행상태(컨설팅·불용PC): WAIT 대기, RECEIVED 접수, DONE 완료 */
    @Column(length = 20)
    public String status;
    public LocalDate visitDate;
    public Boolean secret = false;
    public Integer viewCount = 0;
    @Column(length = 500)
    public String attachFileIds;
    public LocalDateTime createdAt;
    public LocalDateTime updatedAt;
    @Column(length = 1)
    public String useYn = "Y";
}
