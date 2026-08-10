package com.pace.backend.service;

import com.pace.backend.dto.FocusAllowanceResponse;
import com.pace.backend.dto.FocusAllowanceSyncRequest;
import com.pace.backend.entity.FocusAllowance;
import com.pace.backend.repository.FocusAllowanceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
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
@Slf4j
@Service
@RequiredArgsConstructor
public class FocusAllowanceService {

    private final FocusAllowanceRepository repository;

    /**
     * 보관 기간. 이 데이터가 실제로 쓰이는 건 **오늘 하루치뿐**이다(하루 3회 한도, 자정 리셋) —
     * 시간대 경계(클라이언트 로컬 날짜를 쓰므로 서버 기준 하루 앞뒤가 생긴다)를 위한 여유만 있으면 된다.
     *
     * 2026-08-10 사장님 질문("서버 용량 비용 드는 거 아냐? 다른 앱들은 어떻게 하는지 찾아봐") 조사 결과 —
     * 업계 표준은 Redis에 기간만큼 TTL을 걸어 카운터가 스스로 사라지게 하는 것이다(정리 작업도,
     * 누적 증가도 없다). 다만 Redis를 쓰는 진짜 이유는 저장 비용이 아니라 **분산 환경**(인스턴스가
     * 여러 개면 프로세스 로컬 카운터는 로드밸런서 뒤에서 우회된다)인데, 우리는 백엔드 인스턴스가
     * 하나라 그 이점이 없고 Railway에 서비스만 하나 더 늘어 오히려 과금이 는다.
     * → Redis는 안 붙이고 **TTL의 개념만** 가져온다. 이 스케줄러가 그 역할이다.
     *   1,000 DAU 기준 상시 7천 행(1 MB 미만)에서 영구히 고정된다.
     */
    private static final int RETENTION_DAYS = 7;

    /**
     * 하루 한 번(새벽 4시) 보관 기간이 지난 행을 지운다. 삭제되는 건 "지난 날짜"뿐이라 오늘의
     * 한도 판정에는 영향이 없다.
     */
    @Scheduled(cron = "0 0 4 * * *")
    @Transactional
    public void purgeOldRows() {
        LocalDate cutoff = LocalDate.now().minusDays(RETENTION_DAYS);
        int deleted = repository.deleteByAllowanceDateBefore(cutoff);
        if (deleted > 0) log.info("[FocusAllowance] 보관기간({}일) 경과 {}건 삭제 (cutoff={})", RETENTION_DAYS, deleted, cutoff);
    }

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
