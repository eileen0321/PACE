package com.pace.backend.controller;

import com.pace.backend.dto.SessionEndRequest;
import com.pace.backend.dto.SessionResponse;
import com.pace.backend.dto.SessionStartRequest;
import com.pace.backend.service.StatsService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "Session")
@RestController
@RequestMapping("/sessions")
@RequiredArgsConstructor
public class SessionController {

    private final StatsService statsService;

    @PostMapping("/start")
    public SessionResponse start(@AuthenticationPrincipal Long userId, @Valid @RequestBody SessionStartRequest request) {
        return statsService.recordSessionStart(userId, request);
    }

    @PostMapping("/end")
    public SessionResponse end(@AuthenticationPrincipal Long userId, @Valid @RequestBody SessionEndRequest request) {
        return statsService.recordSessionEnd(userId, request);
    }

    @GetMapping("/today")
    public List<SessionResponse> today(@AuthenticationPrincipal Long userId) {
        return statsService.today(userId);
    }

    @GetMapping("/recent")
    public List<SessionResponse> recent(@AuthenticationPrincipal Long userId) {
        return statsService.recent(userId);
    }
}
