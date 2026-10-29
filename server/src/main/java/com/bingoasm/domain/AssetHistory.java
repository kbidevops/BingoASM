package com.bingoasm.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "asset_histories", indexes = @Index(columnList = "assetId"))
public class AssetHistory {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long historyId;
    public Long assetId;
    /** CREATE / UPDATE / STATUS / LOCATE / DELETE */
    @Column(length = 20)
    public String actionType;
    @Column(length = 1000)
    public String content;
    public Long workerId;
    public LocalDateTime createdAt;
}
