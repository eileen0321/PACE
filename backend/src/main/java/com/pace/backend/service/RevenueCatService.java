package com.pace.backend.service;

import com.pace.backend.dto.RevenueCatSubscriberResponse;
import com.pace.backend.dto.RevenueCatWebhookPayload.Event;
import com.pace.backend.entity.Subscription;
import com.pace.backend.entity.UserAccount;
import com.pace.backend.repository.SubscriptionRepository;
import com.pace.backend.repository.UserAccountRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Objects;
import java.util.Optional;

/**
 * jlpt-master PaymentService + RevenueCatClient 이식 — 이 프로젝트에서 가장 이식 가치가 큰 부분.
 * jlpt-master가 실제로 겪은 사고(해지=CANCELLATION을 즉시 박탈로 처리했다가 "결제했는데 해지 시점에
 * 즉시 이용정지"가 되어 Apple/Google 정책 위반·환불 분쟁을 유발)를 반영한 상태 머신을 그대로 옮긴다.
 * PACE_ARCHITECTURE.md "RevenueCat 백엔드 웹훅 계약" / "백엔드 스택 확정" 섹션과 1:1 대응.
 */
@Slf4j
@Service
public class RevenueCatService {

    private static final String CANCEL_REASON_CUSTOMER_SUPPORT = "CUSTOMER_SUPPORT";

    private final UserAccountRepository userAccountRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final String webhookAuthHeader;
    private final String apiKey;
    private final RestClient restClient;

    public RevenueCatService(
            UserAccountRepository userAccountRepository,
            SubscriptionRepository subscriptionRepository,
            @Value("${pace.revenuecat.webhook-auth-header}") String webhookAuthHeader,
            @Value("${pace.revenuecat.api-key}") String apiKey) {
        this.userAccountRepository = userAccountRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.webhookAuthHeader = webhookAuthHeader;
        this.apiKey = apiKey;
        this.restClient = RestClient.builder()
                .baseUrl("https://api.revenuecat.com/v1")
                .defaultHeader("Authorization", "Bearer " + (apiKey == null ? "" : apiKey))
                .build();
    }

    /** 상수시간 비교, fail-closed — 시크릿 미설정이거나 헤더가 없으면 무조건 거부. */
    public boolean isValidWebhookAuth(String authorizationHeader) {
        if (webhookAuthHeader == null || webhookAuthHeader.isBlank() || authorizationHeader == null) {
            return false;
        }
        return MessageDigest.isEqual(
                authorizationHeader.getBytes(StandardCharsets.UTF_8),
                webhookAuthHeader.getBytes(StandardCharsets.UTF_8)
        );
    }

    @Transactional
    public void handleWebhook(Event event) {
        Optional<UserAccount> userOpt = resolveUser(event);
        if (userOpt.isEmpty()) {
            log.warn("RevenueCat 웹훅: 유저를 찾을 수 없음(실결제인데 프리미엄 미부여 위험) — appUserId={}, aliases={}, type={}",
                    event.appUserId(), event.aliases(), event.type());
            return;
        }
        UserAccount user = userOpt.get();
        LocalDateTime expiresAt = toLocalDateTime(event.expirationAtMs());

        switch (event.type()) {
            case "INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "TRANSFER", "PRODUCT_CHANGE" ->
                    grantPremium(user, expiresAt, event.productId());
            case "CANCELLATION" -> {
                // ⚠️ 즉시 박탈 금지(만료일까지 유지) — jlpt-master가 UNSUBSCRIBE까지 즉시박탈 처리했다가
                // 겪은 실사고를 반영해, CUSTOMER_SUPPORT(환불) 사유일 때만 즉시 박탈한다.
                if (CANCEL_REASON_CUSTOMER_SUPPORT.equals(event.cancelReason())) {
                    revokeImmediately(user);
                } else {
                    log.info("RevenueCat CANCELLATION({}): 만료일까지 유지 — userId={}", event.cancelReason(), user.getId());
                }
            }
            case "EXPIRATION" -> {
                // 그 사이 재구독으로 만료일이 이미 미래로 갱신돼 있으면(웹훅 역전 도착) 무시.
                if (user.getPremiumExpiresAt() == null || !user.getPremiumExpiresAt().isAfter(LocalDateTime.now())) {
                    revokePremium(user);
                } else {
                    log.info("RevenueCat EXPIRATION 무시(이미 재구독으로 만료일 연장됨) — userId={}", user.getId());
                }
            }
            case "BILLING_ISSUE" -> log.info("RevenueCat BILLING_ISSUE — grace 기간, 박탈 보류 — userId={}", user.getId());
            default -> log.debug("RevenueCat 웹훅 미처리 이벤트 타입: {}", event.type());
        }
    }

    /**
     * 웹훅 누락 보정 — /auth/refresh 시점에 RC REST API로 재조회해 premium 상태를 동기화한다.
     * API 키 미설정이거나 게스트(이메일 없음)면 no-op(안전한 기본값, jlpt-master와 동일).
     */
    public void reconcile(UserAccount user) {
        if (apiKey == null || apiKey.isBlank() || user.getEmail() == null) {
            return;
        }
        try {
            RevenueCatSubscriberResponse response = restClient.get()
                    .uri("/subscribers/{id}", user.getEmail())
                    .retrieve()
                    .body(RevenueCatSubscriberResponse.class);
            if (response == null || response.subscriber() == null || response.subscriber().entitlements() == null) {
                return;
            }
            response.subscriber().entitlements().values().stream()
                    .map(RevenueCatSubscriberResponse.Entitlement::expiresDate)
                    .filter(Objects::nonNull)
                    .map(this::parseIsoDateTime)
                    .max(LocalDateTime::compareTo)
                    .ifPresent(latestExpiry -> grantPremium(user, latestExpiry, null));
        } catch (Exception e) {
            // reconcile은 보정 수단이지 진실원천이 아님 — 실패해도 기존 웹훅 기반 상태를 그대로 유지한다.
            log.warn("RevenueCat reconcile 실패 — userId={}, error={}", user.getId(), e.getMessage());
        }
    }

    private void grantPremium(UserAccount user, LocalDateTime newExpiresAt, String productId) {
        // 역전/지연 이벤트 방어: 새 만료일이 기존보다 과거면 스킵.
        if (user.getPremiumExpiresAt() != null && newExpiresAt != null
                && newExpiresAt.isBefore(user.getPremiumExpiresAt())) {
            log.info("RevenueCat 역전/지연 이벤트로 판단해 스킵 — userId={}, 기존만료={}, 신규만료={}",
                    user.getId(), user.getPremiumExpiresAt(), newExpiresAt);
            return;
        }
        user.setPremium(true);
        user.setPremiumExpiresAt(newExpiresAt);
        userAccountRepository.save(user);
        upsertSubscriptionMirror(user, productId, true, newExpiresAt);
    }

    private void revokePremium(UserAccount user) {
        user.setPremium(false);
        userAccountRepository.save(user);
        upsertSubscriptionMirror(user, null, false, user.getPremiumExpiresAt());
    }

    private void revokeImmediately(UserAccount user) {
        user.setPremium(false);
        user.setPremiumExpiresAt(LocalDateTime.now());
        userAccountRepository.save(user);
        upsertSubscriptionMirror(user, null, false, user.getPremiumExpiresAt());
    }

    private void upsertSubscriptionMirror(UserAccount user, String plan, boolean active, LocalDateTime expiresAt) {
        Subscription subscription = subscriptionRepository.findById(user.getId()).orElseGet(Subscription::new);
        subscription.setUserId(user.getId());
        if (plan != null) {
            subscription.setPlan(plan);
        }
        subscription.setActive(active);
        subscription.setExpiresAt(expiresAt);
        subscriptionRepository.save(subscription);
    }

    /** app_user_id가 익명ID($RCAnonymousID:)면 event.aliases에서 이메일 패턴을 찾아 폴백 매칭한다. */
    private Optional<UserAccount> resolveUser(Event event) {
        if (event.appUserId() != null && event.appUserId().contains("@")) {
            Optional<UserAccount> found = userAccountRepository.findByEmail(event.appUserId());
            if (found.isPresent()) {
                return found;
            }
        }
        if (event.aliases() != null) {
            for (String alias : event.aliases()) {
                if (alias != null && alias.contains("@")) {
                    Optional<UserAccount> found = userAccountRepository.findByEmail(alias);
                    if (found.isPresent()) {
                        return found;
                    }
                }
            }
        }
        return Optional.empty();
    }

    private LocalDateTime toLocalDateTime(Long epochMs) {
        return epochMs == null ? null : LocalDateTime.ofInstant(Instant.ofEpochMilli(epochMs), ZoneOffset.UTC);
    }

    private LocalDateTime parseIsoDateTime(String iso8601) {
        return LocalDateTime.ofInstant(Instant.parse(iso8601), ZoneOffset.UTC);
    }
}
