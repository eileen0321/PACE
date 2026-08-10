package com.pace.backend.controller;

import com.pace.backend.dto.FocusAllowanceResponse;
import com.pace.backend.dto.FocusAllowanceSyncRequest;
import com.pace.backend.service.FocusAllowanceService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;

/**
 * 무료 Focus Session 허용량(하루 광고 3회 / 타임아웃 여부 / 세션 마감시각)의 서버 동기화.
 * 게스트(비로그인)도 /auth/guest로 user_account를 갖기 때문에 그대로 보호된다.
 */
@Tag(name = "FocusAllowance")
@RestController
@RequestMapping("/focus-allowance")
@RequiredArgsConstructor
public class FocusAllowanceController {

    private final FocusAllowanceService focusAllowanceService;

    /** 부팅 시 1회. 클라이언트는 이 값과 로컬을 합쳐(max/OR) 채택한다. */
    @GetMapping
    public FocusAllowanceResponse get(
            @AuthenticationPrincipal Long userId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return focusAllowanceService.get(userId, date != null ? date : LocalDate.now());
    }

    /** 광고 보상/연장/타임아웃이 실제로 일어난 순간에 올린다. 서버는 병합만 하고 덮어쓰지 않는다. */
    @PostMapping("/sync")
    public FocusAllowanceResponse sync(@AuthenticationPrincipal Long userId,
                                       @Valid @RequestBody FocusAllowanceSyncRequest request) {
        return focusAllowanceService.sync(userId, request);
    }
}
