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

    @GetMapping
    public List<ShortsHotVideoResponse> get(@RequestParam(defaultValue = "all") String category) {
        return shortsHotService.get(category);
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
