package com.pace.backend.dto;

import com.pace.backend.entity.InsightItem;

public record InsightItemResponse(String en, String ko) {
    public static InsightItemResponse of(InsightItem item) {
        return new InsightItemResponse(item.getTextEn(), item.getTextKo());
    }
}
