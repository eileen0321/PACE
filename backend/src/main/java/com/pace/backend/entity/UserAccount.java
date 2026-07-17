package com.pace.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "user_account")
@Getter
@Setter
@NoArgsConstructor
public class UserAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true)
    private String email;

    private String name;

    @Column(nullable = false, length = 32)
    private String provider;

    @Column(name = "device_id", unique = true)
    private String deviceId;

    @Column(nullable = false)
    private boolean premium = false;

    @Column(name = "premium_expires_at")
    private LocalDateTime premiumExpiresAt;

    @Column(name = "token_version", nullable = false)
    private int tokenVersion = 0;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        LocalDateTime now = LocalDateTime.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = LocalDateTime.now();
    }

    /**
     * 웹훅 누락 방어: premium=true여도 만료일이 지났으면 무효로 취급한다(jlpt-master UserAccount와 동일 사상).
     */
    public boolean isPremiumValid() {
        return premium && (premiumExpiresAt == null || premiumExpiresAt.isAfter(LocalDateTime.now()));
    }
}
