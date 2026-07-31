package com.pace.backend.dto;

import com.pace.backend.entity.ShortsHotVideo;

public record ShortsHotVideoResponse(
        String videoId,
        String title,
        String channel,
        String thumbnailUrl
) {
    public static ShortsHotVideoResponse of(ShortsHotVideo v) {
        return new ShortsHotVideoResponse(v.getVideoId(), v.getTitle(), v.getChannel(), v.getThumbnailUrl());
    }
}
