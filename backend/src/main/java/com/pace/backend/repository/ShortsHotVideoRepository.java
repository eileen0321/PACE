package com.pace.backend.repository;

import com.pace.backend.entity.ShortsHotVideo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface ShortsHotVideoRepository extends JpaRepository<ShortsHotVideo, Long> {
    List<ShortsHotVideo> findByCategoryOrderByRankAsc(String category);

    @Transactional
    void deleteByCategory(String category);
}
