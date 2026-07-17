package com.pace.backend.dto;

import java.util.List;

/**
 * 별도 user_metrics/platform_usage 테이블 없이 viewing_session에서 즉석 계산해 반환한다
 * (auto_next_used 컬럼이 이미 있어 별도 저장 없이 산출 가능 — platformBreakdown도 저장 대신 응답 시점 계산).
 */
public record InsightsResponse(
        int totalSessions,
        int longestSessionSeconds,
        double autoNextRatio,
        List<PlatformBreakdownItem> platformBreakdown
) {
}
