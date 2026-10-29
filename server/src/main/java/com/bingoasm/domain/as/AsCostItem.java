package com.bingoasm.domain.as;

import jakarta.persistence.*;

/** AS 처리 보고서의 비용 항목 (부품·공임·출장·기타). 합계가 AsRequest.processAmount. */
@Entity
@Table(name = "as_cost_items", indexes = @Index(columnList = "asvcSn"))
public class AsCostItem {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long costItemId;
    public Long asvcSn;
    /** PART 부품 / LABOR 공임 / TRAVEL 출장 / ETC 기타 */
    @Column(length = 10, nullable = false)
    public String costType;
    @Column(length = 100, nullable = false)
    public String itemName;
    public Integer quantity;
    public Long unitPrice;
    /** quantity × unitPrice */
    public Long amount;
    public Integer sortOrder;
}
