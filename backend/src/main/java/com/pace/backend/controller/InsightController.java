package com.pace.backend.controller;

import com.pace.backend.dto.InsightBundleResponse;
import com.pace.backend.service.InsightService;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// 로그인/게스트 둘 다 인증된 사용자라 SecurityConfig의 permitAll 화이트리스트에 추가하지 않는다
// (ShortsHotController와 동일 원칙) — 표준 JWT 인증 경로로 충분.
@Tag(name = "Insight")
@RestController
@RequestMapping("/insights")
@RequiredArgsConstructor
public class InsightController {

    private final InsightService insightService;

    @GetMapping
    public InsightBundleResponse get() {
        return insightService.getBundle();
    }
}
