package com.pace.backend.dto;

import java.util.List;

// 홈 배너 인사이트 문구 전체 묶음 — 클라이언트(usageInsight.ts)가 이 응답을 통째로 캐시해두고
// 매번 그 안에서 로컬 랜덤 하나를 뽑는다(문구 하나 볼 때마다 네트워크를 타지 않게).
public record InsightBundleResponse(
        List<InsightItemResponse> healing,
        List<InsightItemResponse> quote,
        List<InsightItemResponse> tip,
        List<InsightItemResponse> statYesterdayLastWatched,
        List<InsightItemResponse> statTodayMoreThanAvg,
        List<InsightItemResponse> statTodayLessThanAvg
) {
}
