package com.bingoasm;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
// AS 지연 알림 (AsAlertService) 정기 확인
@org.springframework.scheduling.annotation.EnableScheduling
public class BingoAsmApplication {
    public static void main(String[] args) {
        SpringApplication.run(BingoAsmApplication.class, args);
    }
}
