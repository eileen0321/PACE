package com.pace.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.pace.backend.dto.ShortsHotVideoResponse;
import com.pace.backend.entity.ShortsHotVideo;
import com.pace.backend.repository.ShortsHotChannelRepository;
import com.pace.backend.repository.ShortsHotVideoRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/**
 * 2026-08-10 "HOT 탭이 통째로 비어 있다"(사장님: "쇼츠 핫리스트 유머 게임 안 나오잖아, 다 출시했는데
 * 어쩔거야") 사고의 **마지막 방어선**을 고정한다.
 *
 * 왜 이게 회귀 테스트 대상인가 — 이 폴백은 "앱을 이미 출시해서 클라이언트를 못 고치는 상황"을 전제로
 * 서버에 넣은 것이다(2803cbf). 누군가 나중에 "카테고리 요청에 다른 카테고리를 주는 건 이상하다"고
 * 판단해 이 분기를 지우면, 데이터가 잠깐이라도 비는 순간 출시된 앱에 **빈 화면**이 그대로 나간다.
 * 지울 거면 이 테스트를 함께 고쳐야 한다는 표시이기도 하다.
 *
 * ⚠️ 여기서 검증하는 것은 **읽기 경로(get)와 국가 정규화**뿐이다. 같은 날 고친 채널 발견의
 *   publishedAfter 문제(87899b2)는 YouTube API를 실제로 때리는 private 경로라 단위 테스트로
 *   못 잡는다 — QA_REGRESSION_2026-08-10.md의 수동 항목으로 남겼다.
 */
class ShortsHotServiceTest {

    private ShortsHotVideoRepository repository;
    private ShortsHotService service;

    @BeforeEach
    void setUp() {
        repository = mock(ShortsHotVideoRepository.class);
        ShortsHotChannelRepository channelRepository = mock(ShortsHotChannelRepository.class);
        service = new ShortsHotService(repository, channelRepository, new ObjectMapper());
    }

    private ShortsHotVideo video(String country, String category, int rank, String videoId) {
        return new ShortsHotVideo(country, category, rank, videoId, "제목 " + videoId, "채널",
                "https://i.ytimg.com/vi/" + videoId + "/hq.jpg", LocalDateTime.now());
    }

    private void rows(String country, String category, ShortsHotVideo... videos) {
        when(repository.findByCountryAndCategoryOrderByRankAsc(country, category)).thenReturn(List.of(videos));
    }

    // ── 국가 정규화(KR/JP/US 화이트리스트) ─────────────────────────────────────

    @Test
    void 지원_국가는_대문자로_정규화된다() {
        assertThat(ShortsHotService.normalizeCountry("kr")).isEqualTo("KR");
        assertThat(ShortsHotService.normalizeCountry(" jp ")).isEqualTo("JP");
        assertThat(ShortsHotService.normalizeCountry("US")).isEqualTo("US");
    }

    @Test
    void 지원하지_않는_국가와_null은_US로_폴백한다() {
        assertThat(ShortsHotService.normalizeCountry("FR")).isEqualTo("US");
        assertThat(ShortsHotService.normalizeCountry(null)).isEqualTo("US");
        assertThat(ShortsHotService.normalizeCountry("")).isEqualTo("US");
    }

    // ── 빈 탭 방지(2803cbf) ────────────────────────────────────────────────────

    /** 🔴 music/gaming 탭이 통째로 비어 보이던 그 증상. 서버가 all로 대신 채워 응답해야 한다. */
    @Test
    void 카테고리가_비면_all_목록으로_대체해_응답한다() {
        rows("KR", "music");                       // 0건
        rows("KR", "all", video("KR", "all", 1, "aaa"), video("KR", "all", 2, "bbb"));

        List<ShortsHotVideoResponse> result = service.get("KR", "music");

        assertThat(result).hasSize(2);
        assertThat(result.get(0).videoId()).isEqualTo("aaa");
    }

    /** 데이터가 실제로 들어오면 폴백은 타지 않는다 — 원래 카테고리가 항상 이긴다. */
    @Test
    void 카테고리에_데이터가_있으면_폴백을_타지_않는다() {
        rows("KR", "music", video("KR", "music", 1, "mmm"));

        List<ShortsHotVideoResponse> result = service.get("KR", "music");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).videoId()).isEqualTo("mmm");
        verify(repository, never()).findByCountryAndCategoryOrderByRankAsc("KR", "all");
    }

    /** all 자신이 비었을 때 자기를 다시 조회하는 무한/무의미 폴백이 없어야 한다. */
    @Test
    void all이_비면_그냥_빈_목록이다() {
        rows("KR", "all");

        assertThat(service.get("KR", "all")).isEmpty();
        verify(repository, times(1)).findByCountryAndCategoryOrderByRankAsc("KR", "all");
    }

    /** 앱이 모르는 카테고리를 보내와도(구버전/오타) all로 정규화돼 빈 화면이 되지 않는다. */
    @Test
    void 알_수_없는_카테고리는_all로_정규화된다() {
        rows("KR", "all", video("KR", "all", 1, "aaa"));

        assertThat(service.get("KR", "존재하지않는카테고리")).hasSize(1);
        verify(repository).findByCountryAndCategoryOrderByRankAsc("KR", "all");
    }

    @Test
    void 국가_정규화가_조회에도_그대로_적용된다() {
        rows("US", "all", video("US", "all", 1, "uuu"));

        assertThat(service.get("FR", "all")).hasSize(1);
        verify(repository).findByCountryAndCategoryOrderByRankAsc("US", "all");
    }
}
