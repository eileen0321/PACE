package com.pace.backend.config;

import com.pace.backend.config.jwt.JwtAuthenticationFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * jlpt-master SecurityConfig 이식 — CSRF 비활성(무상태 REST API), 세션 STATELESS, JWT 필터를
 * UsernamePasswordAuthenticationFilter 앞에 배치. permitAll 경로는 로그인/게스트/웹훅/API 문서뿐이고
 * 나머지는 전부 인증 필요 — jlpt-master 주석에 남은 "permitAll 순서 실수로 프리미엄 오디오가 샌 사고"
 * 교훈을 반영해 화이트리스트를 최소한으로 좁게 유지한다.
 */
@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final RestAuthenticationEntryPoint restAuthenticationEntryPoint;

    private static final String[] PUBLIC_PATHS = {
            "/auth/google", "/auth/apple", "/auth/guest",
            "/webhooks/revenuecat",
            "/docs", "/docs/**", "/api-docs", "/api-docs/**", "/v3/api-docs/**", "/swagger-ui/**",
            "/actuator/health"
    };

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(ex -> ex.authenticationEntryPoint(restAuthenticationEntryPoint))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(PUBLIC_PATHS).permitAll()
                        .anyRequest().authenticated())
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
