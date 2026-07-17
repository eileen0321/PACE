package com.pace.backend.controller;

import com.pace.backend.dto.*;
import com.pace.backend.service.AuthService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@Tag(name = "Auth")
@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/google")
    public AuthResultResponse google(@Valid @RequestBody GoogleLoginRequest request) {
        return authService.loginWithGoogle(request);
    }

    @PostMapping("/apple")
    public AuthResultResponse apple(@Valid @RequestBody AppleLoginRequest request) {
        return authService.loginWithApple(request);
    }

    @PostMapping("/guest")
    public AuthResultResponse guest(@Valid @RequestBody GuestLoginRequest request) {
        return authService.loginAsGuest(request);
    }

    @PostMapping("/refresh")
    public TokenResponse refresh(@AuthenticationPrincipal Long userId) {
        return authService.refresh(userId);
    }

    @GetMapping("/status")
    public AuthStatusResponse status(@AuthenticationPrincipal Long userId) {
        return authService.status(userId);
    }

    @DeleteMapping("/account")
    public ResponseEntity<Void> deleteAccount(@AuthenticationPrincipal Long userId) {
        authService.deleteAccount(userId);
        return ResponseEntity.noContent().build();
    }
}
