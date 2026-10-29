package com.bingoasm.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "asset_categories")
public class Category {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long categoryId;
    /** HW / SW */
    @Column(length = 2)
    public String assetType;
    @Column(length = 100)
    public String categoryName;
    public Integer sortOrder;
    /** 내용연수(년) */
    public Integer lifeYears;
    @Column(length = 1)
    public String useYn = "Y";
}
