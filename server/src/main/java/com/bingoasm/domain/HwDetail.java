package com.bingoasm.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

/** Hardware detail stored on the asset row (hw_* columns). */
@Embeddable
public class HwDetail {
    @Column(name = "hw_host_name") public String hostName;
    @Column(name = "hw_cpu") public String cpu;
    @Column(name = "hw_memory") public String memory;
    @Column(name = "hw_disk") public String disk;
    @Column(name = "hw_os_name") public String osName;
    @Column(name = "hw_ip_address") public String ipAddress;
    @Column(name = "hw_mac_address") public String macAddress;

    public boolean isEmpty() {
        return hostName == null && cpu == null && memory == null && disk == null && osName == null && ipAddress == null && macAddress == null;
    }
}
