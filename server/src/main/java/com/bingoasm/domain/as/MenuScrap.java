package com.bingoasm.domain.as;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/** 메뉴스크랩 (마이페이지). */
@Entity
@Table(name = "menu_scraps", uniqueConstraints = @UniqueConstraint(columnNames = {"userId", "menuKey"}))
public class MenuScrap {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long scrapId;
    public Long userId;
    @Column(length = 100, nullable = false)
    public String menuKey;
    @Column(length = 100)
    public String groupName;
    @Column(length = 100)
    public String title;
    public LocalDateTime createdAt;
}
