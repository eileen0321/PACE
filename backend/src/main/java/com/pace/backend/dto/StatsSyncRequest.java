package com.pace.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

import java.util.List;

public record StatsSyncRequest(
        @NotNull @Valid List<SessionSyncItem> sessions
) {
}
