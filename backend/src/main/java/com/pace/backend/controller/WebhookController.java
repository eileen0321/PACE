package com.pace.backend.controller;

import com.pace.backend.dto.RevenueCatWebhookPayload;
import com.pace.backend.exception.ApiException;
import com.pace.backend.service.RevenueCatService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Webhook")
@RestController
@RequestMapping("/webhooks")
@RequiredArgsConstructor
public class WebhookController {

    private final RevenueCatService revenueCatService;

    @PostMapping("/revenuecat")
    public void revenueCat(HttpServletRequest request, @RequestBody RevenueCatWebhookPayload payload) {
        // fail-closed 상수시간 비교 — SecurityConfig의 permitAll 대상이라 이 컨트롤러가 직접 검증한다.
        if (!revenueCatService.isValidWebhookAuth(request.getHeader("Authorization"))) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "WEBHOOK_AUTH_INVALID", "웹훅 인증에 실패했습니다");
        }
        // RC는 실패(비-200) 시 최대 5회까지 지수 백오프로 재시도하므로, 이 규모의 서버에서는 동기 처리로 충분
        // — 별도 큐/비동기 워커는 도입하지 않는다(과설계 방지).
        revenueCatService.handleWebhook(payload.event());
    }
}
