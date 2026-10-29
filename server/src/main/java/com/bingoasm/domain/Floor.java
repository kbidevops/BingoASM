package com.bingoasm.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "floors", uniqueConstraints = @UniqueConstraint(columnNames = {"buildingId", "floorNo"}))
public class Floor {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long floorId;
    public Long buildingId;
    /** Basement floors are negative (B1 = -1). */
    public Integer floorNo;
    @Column(length = 50)
    public String floorName;
    public Integer sortOrder;
    public Long planFileId;
    public Integer planWidth = 0;
    public Integer planHeight = 0;
}
