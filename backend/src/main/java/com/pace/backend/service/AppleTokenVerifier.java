package com.pace.backend.service;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.RemoteJWKSet;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import com.pace.backend.exception.ApiException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URL;
import java.util.Date;

/**
 * Apple identityToken(JWT) 검증 — Apple 공개 JWKS(appleid.apple.com/auth/keys)로 서명을 검증하고
 * iss/aud/exp를 확인한다. jlpt-master AppleTokenVerifier와 동일한 검증 단계를 nimbus-jose-jwt로 구현.
 * email은 Apple이 identityToken 자체에 매 로그인마다 담아주는 클레임 — name은 토큰에 없고
 * client.ts가 최초 로그인 1회에만 별도 필드로 보낸다(AppleLoginRequest.name).
 */
@Slf4j
@Component
public class AppleTokenVerifier {

    private static final String APPLE_ISSUER = "https://appleid.apple.com";
    private static final String APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

    private final ConfigurableJWTProcessor<SecurityContext> jwtProcessor;
    private final String bundleId;

    public AppleTokenVerifier(@Value("${pace.apple.bundle-id}") String bundleId) {
        this.bundleId = bundleId;
        try {
            JWKSource<SecurityContext> keySource = new RemoteJWKSet<>(new URL(APPLE_JWKS_URL));
            JWSVerificationKeySelector<SecurityContext> keySelector =
                    new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, keySource);
            this.jwtProcessor = new DefaultJWTProcessor<>();
            this.jwtProcessor.setJWSKeySelector(keySelector);
        } catch (Exception e) {
            throw new IllegalStateException("Apple JWKS 초기화 실패", e);
        }
    }

    public ExternalIdentity verify(String identityToken) {
        try {
            JWTClaimsSet claims = jwtProcessor.process(identityToken, null);

            if (!APPLE_ISSUER.equals(claims.getIssuer())) {
                throw ApiException.unauthorized("APPLE_TOKEN_INVALID_ISSUER", "Apple identityToken issuer가 올바르지 않습니다");
            }
            if (claims.getAudience() == null || !claims.getAudience().contains(bundleId)) {
                throw ApiException.unauthorized("APPLE_TOKEN_INVALID_AUDIENCE", "Apple identityToken audience가 올바르지 않습니다");
            }
            if (claims.getExpirationTime() == null || claims.getExpirationTime().before(new Date())) {
                throw ApiException.unauthorized("APPLE_TOKEN_EXPIRED", "Apple identityToken이 만료되었습니다");
            }

            String email = claims.getStringClaim("email");
            if (email == null) {
                throw ApiException.unauthorized("APPLE_TOKEN_NO_EMAIL", "Apple 계정에 이메일이 없습니다");
            }
            return new ExternalIdentity(email, null);
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Apple identityToken 검증 오류: {}", e.getMessage());
            throw ApiException.unauthorized("APPLE_TOKEN_INVALID", "Apple identityToken 검증에 실패했습니다");
        }
    }
}
