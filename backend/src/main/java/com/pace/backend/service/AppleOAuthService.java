package com.pace.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.interfaces.ECPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;

/**
 * Sign in with Apple — 서버측 토큰 교환/폐기 (App Store 5.1.1(v) / TN3194). jlpt-master의 검증된
 * 구현을 PACE(Nimbus JOSE 사용, jjwt 대신)로 이식.
 *
 * <p>계정 삭제 시 Apple 토큰을 서버에서 revoke 해야 한다(리뷰어가 확인 → 토큰 살아있으면 반려). 흐름:
 * <ol>
 *   <li>로그인 시 클라가 보낸 authorizationCode 를 refresh_token 으로 교환해 저장</li>
 *   <li>계정 삭제 시 저장된 refresh_token 을 revoke</li>
 * </ol>
 *
 * <p>필요 자격증명(env, 미설정 시 교환/폐기는 조용히 skip → 계정삭제 자체는 정상 진행):
 * <ul>
 *   <li>{@code pace.apple.bundle-id} = 앱 번들 ID(client_id, com.strides7.pace)</li>
 *   <li>{@code pace.apple.team-id} = Apple Developer Team ID</li>
 *   <li>{@code pace.apple.key-id} = "Sign in with Apple" 키의 Key ID (IAP 키와 별개)</li>
 *   <li>{@code pace.apple.private-key} = 해당 .p8 개인키 PEM 전체</li>
 * </ul>
 */
@Slf4j
@Service
public class AppleOAuthService {

    private static final String APPLE_AUD = "https://appleid.apple.com";
    private static final String TOKEN_URL = "https://appleid.apple.com/auth/token";
    private static final String REVOKE_URL = "https://appleid.apple.com/auth/revoke";

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${pace.apple.bundle-id:com.strides7.pace}")
    private String clientId;
    @Value("${pace.apple.team-id:}")
    private String teamId;
    @Value("${pace.apple.key-id:}")
    private String keyId;
    @Value("${pace.apple.private-key:}")
    private String privateKeyPem;

    /** 교환/폐기에 필요한 자격증명이 모두 설정됐는지. */
    public boolean isConfigured() {
        return notBlank(clientId) && notBlank(teamId) && notBlank(keyId) && notBlank(privateKeyPem);
    }

    /** authorizationCode → refresh_token 교환. 실패/미설정 시 null(로그인은 계속 진행). */
    public String exchangeAuthorizationCode(String authorizationCode) {
        if (!isConfigured() || !notBlank(authorizationCode)) {
            if (!isConfigured()) log.warn("[AppleOAuth] 자격증명 미설정 → authorizationCode 교환 skip");
            return null;
        }
        try {
            String clientSecret = generateClientSecret();
            String form = "client_id=" + enc(clientId)
                    + "&client_secret=" + enc(clientSecret)
                    + "&grant_type=authorization_code"
                    + "&code=" + enc(authorizationCode);
            HttpResponse<String> res = http.send(
                    HttpRequest.newBuilder(URI.create(TOKEN_URL))
                            .timeout(Duration.ofSeconds(15))
                            .header("Content-Type", "application/x-www-form-urlencoded")
                            .POST(HttpRequest.BodyPublishers.ofString(form))
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                log.warn("[AppleOAuth] 토큰 교환 실패 status={} body={}", res.statusCode(), res.body());
                return null;
            }
            JsonNode json = mapper.readTree(res.body());
            JsonNode rt = json.get("refresh_token");
            return rt != null ? rt.asText() : null;
        } catch (Exception e) {
            log.warn("[AppleOAuth] 토큰 교환 예외: {}", e.getMessage());
            return null;
        }
    }

    /** refresh_token 폐기(App Store 계정삭제 요건). 실패해도 예외를 던지지 않는다(삭제를 막지 않음). */
    public void revokeToken(String refreshToken) {
        if (!isConfigured() || !notBlank(refreshToken)) {
            if (!isConfigured()) log.warn("[AppleOAuth] 자격증명 미설정 → revoke skip");
            return;
        }
        try {
            String clientSecret = generateClientSecret();
            String form = "client_id=" + enc(clientId)
                    + "&client_secret=" + enc(clientSecret)
                    + "&token=" + enc(refreshToken)
                    + "&token_type_hint=refresh_token";
            HttpResponse<String> res = http.send(
                    HttpRequest.newBuilder(URI.create(REVOKE_URL))
                            .timeout(Duration.ofSeconds(15))
                            .header("Content-Type", "application/x-www-form-urlencoded")
                            .POST(HttpRequest.BodyPublishers.ofString(form))
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 == 2) {
                log.info("[AppleOAuth] Apple 토큰 revoke 성공");
            } else {
                log.warn("[AppleOAuth] revoke 실패 status={} body={}", res.statusCode(), res.body());
            }
        } catch (Exception e) {
            log.warn("[AppleOAuth] revoke 예외: {}", e.getMessage());
        }
    }

    /** ES256 client_secret JWT 생성 (iss=teamId, sub=clientId, aud=appleid, kid=keyId). */
    private String generateClientSecret() throws Exception {
        ECPrivateKey key = loadPrivateKey(privateKeyPem);
        Instant now = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(teamId)
                .subject(clientId)
                .audience(APPLE_AUD)
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(Duration.ofMinutes(10))))
                .build();
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.ES256).keyID(keyId).build(),
                claims);
        jwt.sign(new ECDSASigner(key));
        return jwt.serialize();
    }

    /** .p8(PKCS#8 PEM) → EC PrivateKey. */
    private ECPrivateKey loadPrivateKey(String pem) throws Exception {
        String base64 = pem
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        byte[] der = Base64.getDecoder().decode(base64);
        return (ECPrivateKey) KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }
}
