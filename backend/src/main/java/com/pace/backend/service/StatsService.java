package com.pace.backend.service;

import com.pace.backend.dto.*;
import com.pace.backend.entity.DailyStats;
import com.pace.backend.entity.ViewingSession;
import com.pace.backend.exception.ApiException;
import com.pace.backend.repository.DailyStatsRepository;
import com.pace.backend.repository.ViewingSessionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * SessionController(실시간 start/end)와 StatsController(오프라인 배치 sync) 두 경로가 같은
 * viewing_session 테이블에 upsert로 합류한다 — 세션 id가 클라이언트가 이미 생성한 UUID라 충돌하지 않는다.
 */
@Service
@RequiredArgsConstructor
public class StatsService {

    private final ViewingSessionRepository viewingSessionRepository;
    private final DailyStatsRepository dailyStatsRepository;

    @Transactional
    public SessionResponse recordSessionStart(Long userId, SessionStartRequest request) {
        ViewingSession session = viewingSessionRepository.findById(request.id()).orElseGet(ViewingSession::new);
        session.setId(request.id());
        session.setUserId(userId);
        session.setPlatform(request.platformApp());
        session.setStartedAt(request.startedAt());
        return SessionResponse.of(viewingSessionRepository.save(session));
    }

    @Transactional
    public SessionResponse recordSessionEnd(Long userId, SessionEndRequest request) {
        ViewingSession session = viewingSessionRepository.findById(request.id())
                .orElseThrow(() -> ApiException.notFound("SESSION_NOT_FOUND",
                        "먼저 /sessions/start로 세션을 시작해야 합니다: " + request.id()));
        if (!session.getUserId().equals(userId)) {
            throw ApiException.unauthorized("SESSION_OWNER_MISMATCH", "본인 세션이 아닙니다");
        }
        session.setEndedAt(request.endedAt());
        session.setDurationSeconds(request.durationSeconds());
        session.setVideosWatched(request.videosWatched());
        session.setAutoNextUsed(request.autoNextUsed());
        session.setStatus(request.status());
        ViewingSession saved = viewingSessionRepository.save(session);
        recomputeDailyStats(userId, request.endedAt().toLocalDate());
        return SessionResponse.of(saved);
    }

    @Transactional
    public StatsSyncResponse syncSessions(Long userId, StatsSyncRequest request) {
        int synced = 0;
        for (SessionSyncItem item : request.sessions()) {
            ViewingSession session = viewingSessionRepository.findById(item.id()).orElseGet(ViewingSession::new);
            session.setId(item.id());
            session.setUserId(userId);
            session.setPlatform(item.platformApp());
            session.setStartedAt(item.startedAt());
            session.setEndedAt(item.endedAt());
            session.setDurationSeconds(item.durationSeconds());
            session.setVideosWatched(item.videosWatched());
            session.setAutoNextUsed(item.autoNextUsed());
            session.setStatus(item.status());
            viewingSessionRepository.save(session);
            if (item.endedAt() != null) {
                recomputeDailyStats(userId, item.endedAt().toLocalDate());
            }
            synced++;
        }
        return new StatsSyncResponse(synced);
    }

    public List<SessionResponse> today(Long userId) {
        LocalDate today = LocalDate.now();
        return sessionsBetween(userId, today, today).stream().map(SessionResponse::of).toList();
    }

    public List<SessionResponse> recent(Long userId) {
        return viewingSessionRepository.findTop20ByUserIdOrderByStartedAtDesc(userId).stream()
                .map(SessionResponse::of).toList();
    }

    public DailyStatsResponse daily(Long userId, LocalDate date) {
        return dailyStatsRepository.findByUserIdAndStatDate(userId, date)
                .map(DailyStatsResponse::of)
                .orElseGet(() -> DailyStatsResponse.empty(date));
    }

    public List<DailyStatsResponse> weekly(Long userId) {
        LocalDate today = LocalDate.now();
        LocalDate weekAgo = today.minusDays(6);
        List<DailyStats> rows = dailyStatsRepository.findByUserIdAndStatDateBetweenOrderByStatDateAsc(userId, weekAgo, today);
        return rows.stream().map(DailyStatsResponse::of).toList();
    }

    public InsightsResponse insights(Long userId) {
        List<ViewingSession> completed = viewingSessionRepository.findCompletedByUserId(userId);
        int totalSessions = completed.size();
        int longest = completed.stream().mapToInt(ViewingSession::getDurationSeconds).max().orElse(0);
        long autoNextCount = completed.stream().filter(ViewingSession::isAutoNextUsed).count();
        double ratio = totalSessions == 0 ? 0.0 : (double) autoNextCount / totalSessions;
        return new InsightsResponse(totalSessions, longest, ratio, platformBreakdown(completed));
    }

    /** 별도 저장 테이블 없이 응답 시점에 계산 — 로컬 statsRepository.getTodayUsageByApp()과 동일 사상. */
    private List<PlatformBreakdownItem> platformBreakdown(List<ViewingSession> sessions) {
        return sessions.stream()
                .filter(s -> s.getPlatform() != null)
                .collect(java.util.stream.Collectors.groupingBy(
                        ViewingSession::getPlatform,
                        java.util.stream.Collectors.summingInt(s -> s.getDurationSeconds() / 60)))
                .entrySet().stream()
                .map(e -> new PlatformBreakdownItem(e.getKey(), e.getValue()))
                .toList();
    }

    /** 로컬 statsRepository.getSessionEndReasons()와 동일한 4개 사유 버킷. */
    public SessionEndReasonsResponse sessionEndReasons(Long userId) {
        List<ViewingSession> completed = viewingSessionRepository.findCompletedByUserId(userId);
        java.util.Map<String, Long> counts = completed.stream()
                .filter(s -> s.getStatus() != null)
                .collect(java.util.stream.Collectors.groupingBy(ViewingSession::getStatus, java.util.stream.Collectors.counting()));
        return new SessionEndReasonsResponse(
                counts.getOrDefault("completed", 0L).intValue(),
                counts.getOrDefault("daily_limit_reached", 0L).intValue(),
                counts.getOrDefault("sleep_timer_expired", 0L).intValue(),
                counts.getOrDefault("manual_stop", 0L).intValue()
        );
    }

    private void recomputeDailyStats(Long userId, LocalDate date) {
        List<ViewingSession> sessions = sessionsBetween(userId, date, date);
        DailyStats stats = dailyStatsRepository.findByUserIdAndStatDate(userId, date)
                .orElseGet(DailyStats::new);
        stats.setUserId(userId);
        stats.setStatDate(date);
        stats.setTotalMinutes((int) (sessions.stream().mapToLong(ViewingSession::getDurationSeconds).sum() / 60));
        stats.setTotalVideos(sessions.stream().mapToInt(ViewingSession::getVideosWatched).sum());
        stats.setSessionCount(sessions.size());
        stats.setLongestSessionSeconds(sessions.stream().mapToInt(ViewingSession::getDurationSeconds).max().orElse(0));
        dailyStatsRepository.save(stats);
    }

    private List<ViewingSession> sessionsBetween(Long userId, LocalDate from, LocalDate to) {
        LocalDateTime start = from.atStartOfDay();
        LocalDateTime end = to.plusDays(1).atStartOfDay();
        return viewingSessionRepository.findByUserIdAndStartedAtBetweenOrderByStartedAtDesc(userId, start, end)
                .stream().filter(s -> s.getEndedAt() != null).toList();
    }
}
