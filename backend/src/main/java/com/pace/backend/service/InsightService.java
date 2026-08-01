package com.pace.backend.service;

import com.pace.backend.dto.InsightBundleResponse;
import com.pace.backend.dto.InsightItemResponse;
import com.pace.backend.repository.InsightItemRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

// 2026-08-01 사용자 지시("출시전에" 백엔드로 이전) — 홈 배너 인사이트 문구(힐링/명언/기능가이드/
// 통계템플릿)가 예전엔 src/services/insightContent.ts에 하드코딩돼 있어서 문구 하나 고치려면
// 앱스토어 재배포(특히 iOS 심사 대기)가 필요했다. insight_item 테이블로 옮겨서 SQL만 바꾸면 앱
// 업데이트 없이 문구를 추가/수정/비활성화할 수 있다. 클라이언트는 이 번들을 통째로 받아 로컬에
// 캐시해두고, 실제 랜덤 선택은 매번 클라이언트에서 한다(문구 하나 볼 때마다 네트워크를 안 탐).
@Service
@RequiredArgsConstructor
public class InsightService {

    private final InsightItemRepository repository;

    private List<InsightItemResponse> byCategory(String category) {
        return repository.findByCategoryAndActiveTrue(category).stream()
                .map(InsightItemResponse::of)
                .toList();
    }

    public InsightBundleResponse getBundle() {
        return new InsightBundleResponse(
                byCategory("healing"),
                byCategory("quote"),
                byCategory("tip"),
                byCategory("stat_yesterdayLastWatched"),
                byCategory("stat_todayMoreThanAvg"),
                byCategory("stat_todayLessThanAvg")
        );
    }
}
