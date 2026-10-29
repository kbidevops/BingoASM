package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "as_histories", indexes = @Index(columnList = "asvcSn"))
public class AsHistory {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long historyId;
    public Long asvcSn;
    @Column(length = 1)
    public String prevStatus;
    @Column(length = 1)
    public String status;
    /** REQUEST RECEIVE RETURN RETURN_CANCEL TRANSFER VISIT REPORT EVALUATE ASSIGN UPDATE CANCEL */
    @Column(length = 20)
    public String action;
    @Column(length = 1000)
    public String content;
    public Long workerId;
    public LocalDateTime createdAt;
}
