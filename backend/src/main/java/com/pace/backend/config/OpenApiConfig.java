package com.pace.backend.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** springdoc-openapi(Swagger UI, /docs) — jlpt-master엔 없던 것, Pace는 신규 도입(사용자 지시). */
@Configuration
public class OpenApiConfig {

    private static final String BEARER_SCHEME = "bearerAuth";

    @Bean
    public OpenAPI paceOpenApi() {
        return new OpenAPI()
                .info(new Info().title("Pace Backend API").version("v1")
                        .description("Pace 백엔드 REST API — PACE_ARCHITECTURE.md \"백엔드 스택 확정\" 섹션 참고"))
                .components(new Components().addSecuritySchemes(BEARER_SCHEME,
                        new SecurityScheme().name(BEARER_SCHEME).type(SecurityScheme.Type.HTTP)
                                .scheme("bearer").bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList(BEARER_SCHEME));
    }
}
