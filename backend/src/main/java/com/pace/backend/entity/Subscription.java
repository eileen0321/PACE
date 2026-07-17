package com.pace.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * RevenueCat 상세 이력/감사용 미러. 실제 프리미엄 판정(JWT의 isPremium, JwtAuthenticationFilter의
 * ROLE_PREMIUM)은 {@link UserAccount#isPremiumValid()}를 쓴다 — 이 엔티티는 plan 이름 등 부가 정보
 * 보관용일 뿐 인증 경로의 진실원천이 아니다.
 */
@Entity
@Table(name = "subscription")
@Getter
@Setter
@NoArgsConstructor
public class Subscription {

    @Id
    @Column(name = "user_id")
    private Long userId;

    private String plan;

    @Column(name = "is_active", nullable = false)
    private boolean active = false;

    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = LocalDateTime.now();
    }
}
