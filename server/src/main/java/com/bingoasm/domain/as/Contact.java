package com.bingoasm.domain.as;

import jakarta.persistence.*;

/** 문의처 안내 항목. */
@Entity
@Table(name = "as_contacts")
public class Contact {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long contactId;
    public Long orgId;
    /** null = 도교육청, 그 외 교육지원청 */
    public Long regionId;
    @Column(length = 100, nullable = false)
    public String groupName;
    @Column(length = 100, nullable = false)
    public String itemName;
    @Column(length = 100)
    public String tel;
    @Column(length = 200)
    public String note;
    /** 담당 업무 (줄바꿈 구분) */
    @Column(length = 2000)
    public String duties;
    public Integer sortOrder;
}
