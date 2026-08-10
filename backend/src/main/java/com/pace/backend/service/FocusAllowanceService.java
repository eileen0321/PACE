package com.pace.backend.service;

import com.pace.backend.dto.FocusAllowanceResponse;
import com.pace.backend.dto.FocusAllowanceSyncRequest;
import com.pace.backend.entity.FocusAllowance;
import com.pace.backend.repository.FocusAllowanceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 무료 Focus Session 허용량의 서버측 진실원천(V7__focus_allowance.sql 주석 참고).
 *
 * ⚠️ 핵심 규칙: 클라이언트 값으로 **덮어쓰지 않는다.** 앱을 지웠다 깔면 클라이언트는 0/false를
 * 들고 오는데 그걸 그대로 받으면 서버 기록이 지워져 이 기능이 아무 의미가 없어진다. 그래서
 * 카운트는 max, timedOut은 OR로만 움직인다(= 한 방향으로만 늘어난다).
 */
@Service
@RequiredArgsConstructor
public class FocusAllowanceService {

    private final FocusAllowanceRepository repository;

    @Transactional(readOnly = true)
    public FocusAllowanceResponse get(Long userId, LocalDate date) {
        return repository.findByUserIdAndAllowanceDate(userId, date)
                .map(FocusAllowanceResponse::of)
                .orElseGet(() -> FocusAllowanceResponse.empty(date));
    }

    @Transactional
    public FocusAllowanceResponse sync(Long userId, FocusAllowanceSyncRequest request) {
        FocusAllowance allowance = repository.findByUserIdAndAllowanceDate(userId, request.date())
                .orElseGet(() -> {
                    FocusAllowance created = new FocusAllowance();
                    created.setUserId(userId);
                    created.setAllowanceDate(request.date());
                    return created;
                });

        // 단조 증가만 허용 — 재설치 후 올라온 0이 기존 기록을 지우지 못한다.
        allowance.setAdExtendCount(Math.max(allowance.getAdExtendCount(), request.adExtendCount()));
        allowance.setTimedOut(allowance.isTimedOut() || request.timedOut());

        // 마감시각은 "더 나중"을 채택한다 — 광고/크레딧으로 연장한 결과가 반영돼야 하기 때문.
        // 다만 timedOut이 선 상태에서 남은 시간이 되살아나면 게이트가 풀리므로, 그때는 비운다.
        Instant incoming = request.sessionEndsAt();
        Instant current = allowance.getSessionEndsAt();
        if (incoming != null && (current == null || incoming.isAfter(current))) {
            allowance.setSessionEndsAt(incoming);
            // 연장이 실제로 일어났다는 뜻이므로 타임아웃 상태는 해제한다(광고를 봤거나 크레딧을 썼다).
            if (incoming.isAfter(Instant.now())) allowance.setTimedOut(false);
        }
        // 저장된 마감시각이 이미 지났으면 그건 "시간이 다 된" 것이다 — 앱을 껐다 켜서 게이트를
        // 피하는 경로를 서버에서도 막는다(클라이언트 useFocusSessionStore.load()와 같은 판정).
        if (allowance.getSessionEndsAt() != null && !allowance.getSessionEndsAt().isAfter(Instant.now())) {
            allowance.setSessionEndsAt(null);
            allowance.setTimedOut(true);
        }

        allowance.setUpdatedAt(Instant.now());
        return FocusAllowanceResponse.of(repository.save(allowance));
    }
}
