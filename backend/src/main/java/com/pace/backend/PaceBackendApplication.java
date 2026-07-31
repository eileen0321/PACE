package com.pace.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

// @EnableScheduling — ShortsHotService.refreshAll()의 @Scheduled 매일 갱신 작업에 필요.
@SpringBootApplication
@EnableScheduling
public class PaceBackendApplication {
    public static void main(String[] args) {
        SpringApplication.run(PaceBackendApplication.class, args);
    }
}
