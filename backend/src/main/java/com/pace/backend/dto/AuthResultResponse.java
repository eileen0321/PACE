package com.pace.backend.dto;

import com.pace.backend.entity.UserAccount;

/** src/services/api/client.ts의 AuthResult 타입과 필드명 1:1로 맞춤(top-level, 래핑 없음). */
public record AuthResultResponse(
        String token,
        String userId,
        String email,
        String name,
        boolean isPremium
) {
    public static AuthResultResponse of(String token, UserAccount user) {
        return new AuthResultResponse(
                token,
                String.valueOf(user.getId()),
                user.getEmail(),
                user.getName(),
                user.isPremiumValid()
        );
    }
}
