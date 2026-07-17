package com.pace.backend.controller;

import com.pace.backend.dto.*;
import com.pace.backend.service.StatsService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

@Tag(name = "Stats")
@RestController
@RequestMapping("/stats")
@RequiredArgsConstructor
public class StatsController {

    private final StatsService statsService;

    @PostMapping("/sync")
    public StatsSyncResponse sync(@AuthenticationPrincipal Long userId, @Valid @RequestBody StatsSyncRequest request) {
        return statsService.syncSessions(userId, request);
    }

    @GetMapping("/daily")
    public DailyStatsResponse daily(
            @AuthenticationPrincipal Long userId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return statsService.daily(userId, date != null ? date : LocalDate.now());
    }

    @GetMapping("/weekly")
    public List<DailyStatsResponse> weekly(@AuthenticationPrincipal Long userId) {
        return statsService.weekly(userId);
    }

    @GetMapping("/insights")
    public InsightsResponse insights(@AuthenticationPrincipal Long userId) {
        return statsService.insights(userId);
    }

    @GetMapping("/session-end-reasons")
    public SessionEndReasonsResponse sessionEndReasons(@AuthenticationPrincipal Long userId) {
        return statsService.sessionEndReasons(userId);
    }
}
