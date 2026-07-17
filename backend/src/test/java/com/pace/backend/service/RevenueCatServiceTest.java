package com.pace.backend.service;

import com.pace.backend.dto.RevenueCatWebhookPayload.Event;
import com.pace.backend.entity.Subscription;
import com.pace.backend.entity.UserAccount;
import com.pace.backend.repository.SubscriptionRepository;
import com.pace.backend.repository.UserAccountRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * jlpt-master가 실사고를 겪고 고친 grant/revoke 상태 머신을 그대로 이식했는지 검증한다.
 * PACE_ARCHITECTURE.md "RevenueCat 백엔드 웹훅 계약" 섹션의 5개 케이스를 그대로 커버.
 */
class RevenueCatServiceTest {

    private UserAccountRepository userAccountRepository;
    private SubscriptionRepository subscriptionRepository;
    private RevenueCatService service;

    @BeforeEach
    void setUp() {
        userAccountRepository = mock(UserAccountRepository.class);
        subscriptionRepository = mock(SubscriptionRepository.class);
        when(subscriptionRepository.findById(any())).thenReturn(Optional.empty());
        when(subscriptionRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(userAccountRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service = new RevenueCatService(userAccountRepository, subscriptionRepository,
                "test-webhook-secret", "");
    }

    private UserAccount premiumUser(LocalDateTime expiresAt) {
        UserAccount user = new UserAccount();
        user.setId(1L);
        user.setEmail("user@example.com");
        user.setPremium(true);
        user.setPremiumExpiresAt(expiresAt);
        return user;
    }

    @Test
    void cancellation_기본사유는_만료일까지_프리미엄을_유지한다() {
        UserAccount user = premiumUser(LocalDateTime.now().plusDays(20));
        when(userAccountRepository.findByEmail("user@example.com")).thenReturn(Optional.of(user));

        Event event = new Event("CANCELLATION", "user@example.com", List.of(), "pace_monthly", null, "UNSUBSCRIBE");
        service.handleWebhook(event);

        assertThat(user.isPremium()).isTrue();
        assertThat(user.getPremiumExpiresAt()).isAfter(LocalDateTime.now().plusDays(19));
    }

    @Test
    void cancellation_고객지원_환불사유는_즉시_박탈한다() {
        UserAccount user = premiumUser(LocalDateTime.now().plusDays(20));
        when(userAccountRepository.findByEmail("user@example.com")).thenReturn(Optional.of(user));

        Event event = new Event("CANCELLATION", "user@example.com", List.of(), "pace_monthly", null, "CUSTOMER_SUPPORT");
        service.handleWebhook(event);

        assertThat(user.isPremium()).isFalse();
        assertThat(user.getPremiumExpiresAt()).isBeforeOrEqualTo(LocalDateTime.now());
    }

    @Test
    void expiration_만료일이_지났으면_박탈한다() {
        UserAccount user = premiumUser(LocalDateTime.now().minusDays(1));
        when(userAccountRepository.findByEmail("user@example.com")).thenReturn(Optional.of(user));

        Event event = new Event("EXPIRATION", "user@example.com", List.of(), "pace_monthly", null, null);
        service.handleWebhook(event);

        assertThat(user.isPremium()).isFalse();
    }

    @Test
    void expiration_그사이_재구독으로_만료일이_미래면_무시한다() {
        UserAccount user = premiumUser(LocalDateTime.now().plusDays(10));
        when(userAccountRepository.findByEmail("user@example.com")).thenReturn(Optional.of(user));

        Event event = new Event("EXPIRATION", "user@example.com", List.of(), "pace_monthly", null, null);
        service.handleWebhook(event);

        assertThat(user.isPremium()).isTrue();
        assertThat(user.getPremiumExpiresAt()).isAfter(LocalDateTime.now().plusDays(9));
    }

    @Test
    void 역전_지연_이벤트는_만료일을_앞당기지_않는다() {
        LocalDateTime currentExpiry = LocalDateTime.now().plusDays(30);
        UserAccount user = premiumUser(currentExpiry);
        when(userAccountRepository.findByEmail("user@example.com")).thenReturn(Optional.of(user));

        long olderExpiryMs = LocalDateTime.now().plusDays(5).toInstant(ZoneOffset.UTC).toEpochMilli();
        Event event = new Event("RENEWAL", "user@example.com", List.of(), "pace_monthly", olderExpiryMs, null);
        service.handleWebhook(event);

        assertThat(user.getPremiumExpiresAt()).isEqualTo(currentExpiry);
    }

    @Test
    void 익명ID는_aliases의_이메일로_유저를_찾는다() {
        UserAccount user = premiumUser(LocalDateTime.now().plusDays(1));
        when(userAccountRepository.findByEmail("user@example.com")).thenReturn(Optional.of(user));

        long newExpiryMs = LocalDateTime.now().plusDays(30).toInstant(ZoneOffset.UTC).toEpochMilli();
        Event event = new Event("RENEWAL", "$RCAnonymousID:abc123",
                List.of("$RCAnonymousID:abc123", "user@example.com"), "pace_monthly", newExpiryMs, null);
        service.handleWebhook(event);

        assertThat(user.isPremium()).isTrue();
        assertThat(user.getPremiumExpiresAt()).isAfter(LocalDateTime.now().plusDays(29));
    }

    @Test
    void 유저를_찾을수없으면_아무것도_하지않는다() {
        when(userAccountRepository.findByEmail(any())).thenReturn(Optional.empty());

        Event event = new Event("RENEWAL", "unknown@example.com", List.of(), "pace_monthly", null, null);
        service.handleWebhook(event);

        verify(userAccountRepository, never()).save(any());
        verify(subscriptionRepository, never()).save(any());
    }

    @Test
    void webhook_인증은_상수시간비교_fail_closed다() {
        assertThat(service.isValidWebhookAuth("test-webhook-secret")).isTrue();
        assertThat(service.isValidWebhookAuth("wrong-secret")).isFalse();
        assertThat(service.isValidWebhookAuth(null)).isFalse();
    }
}
