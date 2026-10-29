package com.bingoasm.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "satisfactions")
public class Satisfaction {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long satisId;
    @Column(unique = true, nullable = false)
    public Long requestId;
    public Integer overallScore;
    public Integer kindnessScore;
    public Integer speedScore;
    public Integer expertiseScore;
    @Column(length = 2000)
    public String comment;
    public Long surveyedBy;
    public LocalDateTime surveyedAt;
}
