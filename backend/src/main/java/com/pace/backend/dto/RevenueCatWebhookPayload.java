package com.pace.backend.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/** RevenueCat 웹훅 페이로드(공식 스펙 기준 필요한 필드만) — https://www.revenuecat.com/docs/integrations/webhooks */
public record RevenueCatWebhookPayload(Event event) {

    public record Event(
            String type,
            @JsonProperty("app_user_id") String appUserId,
            List<String> aliases,
            @JsonProperty("product_id") String productId,
            @JsonProperty("expiration_at_ms") Long expirationAtMs,
            @JsonProperty("cancel_reason") String cancelReason
    ) {
    }
}
