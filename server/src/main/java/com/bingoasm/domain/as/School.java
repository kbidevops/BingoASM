package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** 기관(학교). 원클릭 AS의 신청 주체. */
@Entity
@Table(name = "schools", indexes = @Index(columnList = "orgId"))
public class School {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long schoolId;
    public Long orgId;
    /** 소속 교육지원청(지역). 필수 — 학교에 딸린 AS·게시글·통계의 지역은 모두 여기서 정해진다. */
    @Column(nullable = false)
    public Long regionId;
    @Column(length = 20)
    public String schoolCode;
    @Column(length = 100, nullable = false)
    public String schoolName;
    /** ELEM 초 / MID 중 / HIGH 고 / SPECIAL 특수 / ETC 기타 */
    @Column(length = 10)
    public String schoolType;
    public String address;
    public String tel;
    /** 학급 수 */
    public Integer classCount;
    /** 유지관리 표준계약: CONTRACTED 체결 / NONE 미체결 */
    @Column(length = 15)
    public String contractStatus = "NONE";
    @Column(length = 1000)
    public String memo;
    @Column(length = 1)
    public String useYn = "Y";
    public LocalDateTime createdAt;
}
