package com.bingoasm.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.time.LocalDate;

/** Software / license detail stored on the asset row (sw_* columns). */
@Embeddable
public class SwDetail {
    @Column(name = "sw_version") public String version;
    @Column(name = "sw_publisher") public String publisher;
    @Column(name = "sw_license_type") public String licenseType;
    @Column(name = "sw_license_key") public String licenseKey;
    @Column(name = "sw_license_count") public Integer licenseCount;
    @Column(name = "sw_license_start") public LocalDate licenseStart;
    @Column(name = "sw_license_end") public LocalDate licenseEnd;

    public boolean isEmpty() {
        return version == null && publisher == null && licenseType == null && licenseKey == null && licenseCount == null && licenseStart == null && licenseEnd == null;
    }
}
