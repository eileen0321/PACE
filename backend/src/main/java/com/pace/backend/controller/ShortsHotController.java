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
}
