package com.pace.backend.dto;

import jakarta.validation.constraints.NotBlank;

public record GuestLoginRequest(
        @NotBlank(message = "deviceId는 필수입니다") String deviceId
) {
}
