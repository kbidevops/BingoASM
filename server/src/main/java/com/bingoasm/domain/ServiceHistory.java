package com.bingoasm.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "service_histories", indexes = @Index(columnList = "requestId"))
public class ServiceHistory {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long historyId;
    public Long requestId;
    @Column(length = 20)
    public String prevStatus;
    @Column(length = 20)
    public String status;
    @Column(length = 2000)
    public String content;
    public Long workerId;
    public LocalDateTime createdAt;
}
