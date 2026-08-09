package com.pace.backend.repository;

import com.pace.backend.entity.ShortsHotChannel;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ShortsHotChannelRepository extends JpaRepository<ShortsHotChannel, Long> {

    /** 특정 국가·카테고리의 살아있는 채널들 — 평소 갱신이 읽는 목록. */
    List<ShortsHotChannel> findByCountryAndCategoryAndEnabledTrue(String country, String category);

    Optional<ShortsHotChannel> findByCountryAndCategoryAndChannelId(String country, String category, String channelId);

    long countByCountryAndCategoryAndEnabledTrue(String country, String category);
}
