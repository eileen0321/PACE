package com.pace.backend.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/** GET https://api.revenuecat.com/v1/subscribers/{id} 응답 중 reconcile에 필요한 필드만. */
public record RevenueCatSubscriberResponse(Subscriber subscriber) {

    public record Subscriber(Map<String, Entitlement> entitlements) {
    }

    public record Entitlement(
            @JsonProperty("expires_date") String expiresDate,
            @JsonProperty("product_identifier") String productIdentifier
    ) {
    }
}
