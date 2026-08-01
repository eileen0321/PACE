package com.pace.backend.service;

import com.pace.backend.config.jwt.JwtProvider;
import com.pace.backend.dto.*;
import com.pace.backend.entity.UserAccount;
import com.pace.backend.exception.ApiException;
import com.pace.backend.repository.UserAccountRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * jlpt-master AuthController/AuthService 이식. 로그인마다 tokenVersion을 올려 기존에 발급된 토큰을
 * 전부 무효화한다("새 기기 로그인 → tokenVersion++ → 기존 JWT 전부 무효" — 단일기기 로그인 강제 겸
 * 토큰 일괄 폐기 수단).
 */
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserAccountRepository userAccountRepository;
    private final GoogleTokenVerifier googleTokenVerifier;
    private final AppleTokenVerifier appleTokenVerifier;
    private final AppleOAuthService appleOAuthService;
    private final JwtProvider jwtProvider;
    private final RevenueCatService revenueCatService;

    @Transactional
    public AuthResultResponse loginWithGoogle(GoogleLoginRequest request) {
        ExternalIdentity identity = googleTokenVerifier.verify(request.idToken());
        UserAccount user = upsertByEmail(identity.email(), identity.name(), "google");
        return issueAuthResult(user);
    }

    @Transactional
    public AuthResultResponse loginWithApple(AppleLoginRequest request) {
        ExternalIdentity identity = appleTokenVerifier.verify(request.identityToken());
        // name은 Apple이 최초 로그인 1회에만 클라이언트에 내려주는 값 — 이후 로그인엔 null이라 덮어쓰지 않는다.
        UserAccount user = upsertByEmail(identity.email(), request.name(), "apple");
        // 5.1.1(v)/TN3194 — authorizationCode를 refresh_token으로 교환해 저장(계정삭제 시 revoke용).
        // 최초 로그인 1회에만 authorizationCode가 오고, 자격증명 미설정이면 null 반환(교환 skip). 기존 값은 덮어쓰지 않음.
        if (request.authorizationCode() != null && !request.authorizationCode().isBlank()) {
            String refreshToken = appleOAuthService.exchangeAuthorizationCode(request.authorizationCode());
            if (refreshToken != null) {
                user.setAppleRefreshToken(refreshToken);
            }
        }
        return issueAuthResult(user); // user(appleRefreshToken 포함)를 save한다
    }

    @Transactional
    public AuthResultResponse loginAsGuest(GuestLoginRequest request) {
        UserAccount user = userAccountRepository.findByDeviceId(request.deviceId())
                .orElseGet(() -> {
                    UserAccount created = new UserAccount();
                    created.setDeviceId(request.deviceId());
                    created.setProvider("guest");
                    return created;
                });
        return issueAuthResult(user);
    }

    @Transactional
    public TokenResponse refresh(Long userId) {
        UserAccount user = getUserOrThrow(userId);
        revenueCatService.reconcile(user);
        String token = jwtProvider.generateToken(user);
        return new TokenResponse(token);
    }

    public AuthStatusResponse status(Long userId) {
        return AuthStatusResponse.of(getUserOrThrow(userId));
    }

    @Transactional
    public void deleteAccount(Long userId) {
        UserAccount account = userAccountRepository.findById(userId)
                .orElseThrow(() -> ApiException.notFound("USER_NOT_FOUND", "존재하지 않는 사용자입니다"));
        // 5.1.1(v)/TN3194 — Apple 로그인 계정은 삭제 전 서버에서 Apple 토큰 revoke(Apple이 심사 때 확인).
        // revoke 실패/자격증명 미설정은 삭제를 막지 않는다(서비스 내부에서 예외 삼킴).
        if ("apple".equals(account.getProvider()) && account.getAppleRefreshToken() != null) {
            appleOAuthService.revokeToken(account.getAppleRefreshToken());
        }
        userAccountRepository.delete(account); // FK ON DELETE CASCADE로 하위 데이터 전부 함께 삭제
    }

    private UserAccount upsertByEmail(String email, String name, String provider) {
        UserAccount user = userAccountRepository.findByEmail(email)
                .orElseGet(() -> {
                    UserAccount created = new UserAccount();
                    created.setEmail(email);
                    created.setProvider(provider);
                    return created;
                });
        if (name != null) {
            user.setName(name);
        }
        return user;
    }

    private AuthResultResponse issueAuthResult(UserAccount user) {
        user.setTokenVersion(user.getTokenVersion() + 1);
        UserAccount saved = userAccountRepository.save(user);
        String token = jwtProvider.generateToken(saved);
        return AuthResultResponse.of(token, saved);
    }

    private UserAccount getUserOrThrow(Long userId) {
        return userAccountRepository.findById(userId)
                .orElseThrow(() -> ApiException.notFound("USER_NOT_FOUND", "존재하지 않는 사용자입니다"));
    }
}
