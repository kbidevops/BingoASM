package com.bingoasm.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "departments")
public class Department {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long deptId;
    public Long orgId;
    @Column(nullable = false, length = 100)
    public String deptName;
    public Integer sortOrder;
    @Column(length = 1)
    public String useYn = "Y";
}
