package com.pace.backend.config;

import org.flywaydb.core.Flyway;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

// V2 마이그레이션이 예약어(rank) 문법 오류로 실패해 flyway_schema_history에 실패 기록이 남았고,
// 이후 모든 배포에서 Flyway validate가 막혀 앱이 기동조차 못 했던 사고 이후 추가.
// repair()가 실패 기록을 정리하고 checksum을 재계산해 migrate()가 정상 진행되게 한다.
@Configuration
public class FlywayConfig {

    @Bean
    public FlywayMigrationStrategy flywayMigrationStrategy() {
        return (Flyway flyway) -> {
            flyway.repair();
            flyway.migrate();
        };
    }
}
