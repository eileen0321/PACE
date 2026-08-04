package com.pace.backend.controller;

import com.pace.backend.dto.ShortsHotVideoResponse;
import com.pace.backend.service.ShortsHotService;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

// 로그인/게스트 둘 다 인증된 사용자라 SecurityConfig의 permitAll 화이트리스트에 추가하지 않는다
// (그 파일 상단 주석: 화이트리스트는 로그인/게스트/웹훅/API 문서로만 최소한 유지) — 표준 JWT 인증 경로로 충분.
@Tag(name = "ShortsHot")
@RestController
@RequestMapping("/shorts-hot")
@RequiredArgsConstructor
public class ShortsHotController {

    private final ShortsHotService shortsHotService;

    // 2026-08-04 사장님 결정 — 국가별 목록(KR/JP/US 화이트리스트, 그 외는 US 폴백).
    //
    // 국가는 두 경로로 받는다:
    //  1) 앱이 명시적으로 넘긴 `country` 파라미터 — 다음 앱 업데이트부터 반영된다.
    //  2) `Accept-Language` 헤더의 지역 코드 — **이미 출시된 앱은 country를 안 보내므로**
    //     이 폴백이 있어야 지금 사용자에게도 국가별 목록이 나간다(앱 수정 없이 적용).
    // 둘 다 없거나 지원 목록에 없으면 서비스가 US로 폴백한다.
    @GetMapping
    public List<ShortsHotVideoResponse> get(
            @RequestParam(defaultValue = "all") String category,
            @RequestParam(required = false) String country,
            @RequestHeader(value = "Accept-Language", required = false) String acceptLanguage) {
        return shortsHotService.get(country != null ? country : countryFromAcceptLanguage(acceptLanguage), category);
    }

    // "ko-KR,ko;q=0.9,en;q=0.8" → "KR". 지역 코드가 없으면(예: "ko") null을 돌려 서비스가 폴백하게 둔다.
    private static String countryFromAcceptLanguage(String acceptLanguage) {
        if (acceptLanguage == null || acceptLanguage.isBlank()) return null;
        String first = acceptLanguage.split(",")[0].trim();
        int dash = first.indexOf('-');
        if (dash < 0 || first.length() < dash + 3) return null;
        return first.substring(dash + 1, dash + 3);
    }

    @GetMapping("/categories")
    public List<String> categories() {
        return shortsHotService.categories();
    }

    // 2026-08-01 — 매일 새벽 4시 스케줄러를 기다리지 않고 YOUTUBE_API_KEY 배포 직후 바로 검증하려는
    // 목적의 수동 트리거. 민감 정보 노출은 없고(YouTube API 유닛 몇 개만 소모) 표준 JWT 인증으로
    // 충분해 별도 admin 권한을 새로 만들지 않는다 — 로그인/게스트 누구나 호출 가능하지만 남용돼도
    // 피해가 없다(멱등, 같은 카테고리를 다시 채울 뿐).
    @PostMapping("/refresh")
    public String refresh() {
        shortsHotService.refreshAll();
        return "ok";
    }
}
