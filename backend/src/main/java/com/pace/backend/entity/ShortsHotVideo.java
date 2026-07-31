package com.pace.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "shorts_hot_video", uniqueConstraints = @UniqueConstraint(columnNames = {"category", "rank"}))
@Getter
@Setter
@NoArgsConstructor
public class ShortsHotVideo {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "category", nullable = false, length = 32)
    private String category;

    @Column(name = "rank", nullable = false)
    private int rank;

    @Column(name = "video_id", nullable = false, length = 32)
    private String videoId;

    @Column(name = "title", nullable = false, length = 500)
    private String title;

    @Column(name = "channel", length = 255)
    private String channel;

    @Column(name = "thumbnail_url", nullable = false, length = 500)
    private String thumbnailUrl;

    @Column(name = "refreshed_at", nullable = false)
    private LocalDateTime refreshedAt;

    public ShortsHotVideo(String category, int rank, String videoId, String title, String channel,
                           String thumbnailUrl, LocalDateTime refreshedAt) {
        this.category = category;
        this.rank = rank;
        this.videoId = videoId;
        this.title = title;
        this.channel = channel;
        this.thumbnailUrl = thumbnailUrl;
        this.refreshedAt = refreshedAt;
    }
}
