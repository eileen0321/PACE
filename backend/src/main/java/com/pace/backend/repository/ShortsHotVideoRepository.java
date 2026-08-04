package com.pace.backend.repository;

import com.pace.backend.entity.ShortsHotVideo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface ShortsHotVideoRepository extends JpaRepository<ShortsHotVideo, Long> {
    // 2026-08-04 — 국가별 목록으로 바뀌면서 조회/삭제가 모두 (country, category) 단위가 됐다.
    // 예전 시그니처(category만)는 남겨두지 않는다 — 실수로 전 국가를 한꺼번에 지우는 호출이
    // 가능해지고, 컴파일러가 그걸 잡아주지 못한다.
    List<ShortsHotVideo> findByCountryAndCategoryOrderByRankAsc(String country, String category);

    @Transactional
    void deleteByCountryAndCategory(String country, String category);
}
