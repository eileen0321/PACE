package com.pace.backend.dto;

import com.pace.backend.entity.UserAccount;

/** GET /auth/status 응답 — 가벼운 헬스체크/디버그용(신규, jlpt-master엔 없던 엔드포인트). */
public record AuthStatusResponse(
        String userId,
        String email,
        String name,
        String provider,
        boolean isPremium
) {
    public static AuthStatusResponse of(UserAccount user) {
        return new AuthStatusResponse(
                String.valueOf(user.getId()),
                user.getEmail(),
                user.getName(),
                user.getProvider(),
                user.isPremiumValid()
        );
    }
}
