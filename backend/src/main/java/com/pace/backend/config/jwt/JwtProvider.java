package com.pace.backend.config.jwt;

import com.pace.backend.entity.UserAccount;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

/**
 * jlpt-master JwtProvider 이식 — HS256, claim에 tokenVersion(ver)을 심어 DB의 UserAccount.tokenVersion과
 * 대조하는 방식으로 "새 로그인 시 기존 토큰 전부 무효화"를 구현한다(단일기기 로그인 강제 겸 일괄 폐기 수단).
 */
@Component
public class JwtProvider {

    private static final String CLAIM_EMAIL = "email";
    private static final String CLAIM_PREMIUM = "premium";
    private static final String CLAIM_VERSION = "ver";

    private final SecretKey key;
    private final long expirationMs;

    public JwtProvider(
            @Value("${pace.jwt.secret}") String secret,
            @Value("${pace.jwt.expiration-ms}") long expirationMs) {
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException(
                    "pace.jwt.secret(JWT_SECRET)은 최소 32바이트(256비트) 이상이어야 합니다 — HS256 서명 요구사항");
        }
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expirationMs = expirationMs;
    }

    public String generateToken(UserAccount user) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + expirationMs);
        return Jwts.builder()
                .subject(String.valueOf(user.getId()))
                .claim(CLAIM_EMAIL, user.getEmail())
                .claim(CLAIM_PREMIUM, user.isPremiumValid())
                .claim(CLAIM_VERSION, user.getTokenVersion())
                .issuedAt(now)
                .expiration(expiry)
                .signWith(key)
                .compact();
    }

    /**
     * @throws JwtException 서명 불일치/만료/형식 오류 등 — 호출부(JwtAuthenticationFilter)가 인증 실패로 처리
     */
    public Claims parse(String token) throws JwtException {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public Long getUserId(Claims claims) {
        return Long.valueOf(claims.getSubject());
    }

    public int getTokenVersion(Claims claims) {
        return claims.get(CLAIM_VERSION, Integer.class);
    }

    public boolean getIsPremium(Claims claims) {
        return Boolean.TRUE.equals(claims.get(CLAIM_PREMIUM, Boolean.class));
    }
}
