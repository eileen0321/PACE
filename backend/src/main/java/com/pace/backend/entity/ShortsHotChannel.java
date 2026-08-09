package com.pace.backend.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Shorts HOT 목록을 만들 때 쓰는 **채널 화이트리스트**(V6__shorts_hot_channel.sql 주석에 배경).
 *
 * <p>연령대(20~40대)를 겨냥하는 수단으로 검색어 대신 채널을 쓴다 — 검색어는 유행을 타 몇 주면 낡지만
 * 채널의 시청자층은 잘 안 바뀐다. 평소 갱신은 이 채널들의 업로드 재생목록만 읽어 만든다(1 unit/채널).
 *
 * <p>⚠️ country가 키에 들어간다 — 한국 채널을 일본/미국 사용자에게 보여주면 안 된다.
 */
@Entity
@Table(name = "shorts_hot_channel")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ShortsHotChannel {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "country", nullable = false, length = 2)
    private String country;

    @Column(name = "category", nullable = false, length = 32)
    private String category;

    @Column(name = "channel_id", nullable = false, length = 64)
    private String channelId;

    @Column(name = "channel_title", length = 255)
    private String channelTitle;

    /** 자동 발견에서 이 채널이 몇 번 걸렸는지 — 낮은 채널을 정리할 때 쓴다. */
    @Column(name = "hit_count", nullable = false)
    private int hitCount;

    /** 사람이 직접 넣은 채널은 자동 정리에서 보호한다. */
    @Column(name = "pinned", nullable = false)
    private boolean pinned;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    @Column(name = "discovered_at", nullable = false)
    private LocalDateTime discoveredAt;
}
