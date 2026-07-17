package com.pace.backend.service;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.googleapis.javanet.GoogleNetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.pace.backend.exception.ApiException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.security.GeneralSecurityException;
import java.util.Collections;

/** jlpt-master AuthController의 Google idToken 검증 로직 이식 — google-api-client 공식 패턴 그대로. */
@Slf4j
@Component
public class GoogleTokenVerifier {

    private final GoogleIdTokenVerifier verifier;

    public GoogleTokenVerifier(@Value("${pace.google.client-id}") String clientId) {
        try {
            var transport = GoogleNetHttpTransport.newTrustedTransport();
            this.verifier = new GoogleIdTokenVerifier.Builder(transport, GsonFactory.getDefaultInstance())
                    .setAudience(Collections.singletonList(clientId))
                    .build();
        } catch (GeneralSecurityException | java.io.IOException e) {
            throw new IllegalStateException("Google idToken verifier 초기화 실패", e);
        }
    }

    public ExternalIdentity verify(String idTokenString) {
        try {
            GoogleIdToken idToken = verifier.verify(idTokenString);
            if (idToken == null) {
                throw ApiException.unauthorized("GOOGLE_TOKEN_INVALID", "Google idToken 검증에 실패했습니다");
            }
            GoogleIdToken.Payload payload = idToken.getPayload();
            String email = payload.getEmail();
            String name = (String) payload.get("name");
            if (email == null) {
                throw ApiException.unauthorized("GOOGLE_TOKEN_NO_EMAIL", "Google 계정에 이메일이 없습니다");
            }
            return new ExternalIdentity(email, name);
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Google idToken 검증 오류: {}", e.getMessage());
            throw ApiException.unauthorized("GOOGLE_TOKEN_INVALID", "Google idToken 검증에 실패했습니다");
        }
    }
}
