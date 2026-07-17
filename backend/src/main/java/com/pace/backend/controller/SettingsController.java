package com.pace.backend.controller;

import com.pace.backend.dto.UpdateSettingsRequest;
import com.pace.backend.dto.UserSettingsResponse;
import com.pace.backend.service.SettingsService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@Tag(name = "Settings")
@RestController
@RequestMapping("/settings")
@RequiredArgsConstructor
public class SettingsController {

    private final SettingsService settingsService;

    @GetMapping
    public UserSettingsResponse get(@AuthenticationPrincipal Long userId) {
        return settingsService.get(userId);
    }

    @PutMapping
    public UserSettingsResponse update(@AuthenticationPrincipal Long userId, @Valid @RequestBody UpdateSettingsRequest request) {
        return settingsService.update(userId, request);
    }
}
