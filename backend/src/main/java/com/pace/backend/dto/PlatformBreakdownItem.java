package com.pace.backend.dto;

/** 로컬 statsRepository.getTodayUsageByApp()과 동일 shape — 서버는 저장하지 않고 응답 시점에 계산한다. */
public record PlatformBreakdownItem(String app, int minutes) {
}
