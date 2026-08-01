package com.pace.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pace.backend.dto.ShortsHotVideoResponse;
import com.pace.backend.entity.ShortsHotVideo;
import com.pace.backend.repository.ShortsHotVideoRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

// 2026-07-31/08-01 사장님 지시 — 오버레이 P 메뉴 "Shorts HOT". 클라이언트는 절대 YouTube API 키를
// 직접 쓰지 않는다(src/services/api/youtube.ts 상단 주석의 2026-07-19 보안 교훈과 동일 원칙 — 키를
// 앱 번들에 넣으면 디컴파일로 유출된다). 이 서비스가 매일 새벽 한 번 YouTube Data API를 호출해
// shorts_hot_video 테이블을 카테고리별로 갱신하고, 앱은 ShortsHotController로 캐시된 결과만 읽는다.
//
// 60초 이하만 "Shorts"로 인정(videos.list의 contentDetails.duration, ISO-8601 "PT#M#S")한다 —
// videos.list에는 "이게 쇼츠인지" 필드가 따로 없어(공식 API 한계) 길이로만 판별 가능. chart=
// mostPopular는 규정상 정렬된 인기 목록만 주고 duration 필터를 못 받으므로, 넉넉히 50개를 받아
// 60초 이하만 남기고 상위 N개를 취한다 — 카테고리에 따라 결과가 N보다 적을 수 있다(허용).
@Slf4j
@Service
@RequiredArgsConstructor
public class ShortsHotService {

    private static final String VIDEOS_API = "https://www.googleapis.com/youtube/v3/videos";
    private static final int MAX_SHORT_SECONDS = 60;
    private static final int FETCH_COUNT = 50;
    private static final int KEEP_COUNT = 15;

    // 카테고리 코드(앱/DB에서 쓰는 값) → YouTube videoCategoryId. "all"은 categoryId 없이
    // chart=mostPopular 전체 순위(카테고리 무관)를 그대로 쓴다.
    private static final Map<String, String> CATEGORIES = new LinkedHashMap<>();
    static {
        CATEGORIES.put("all", null);
        CATEGORIES.put("music", "10");
        CATEGORIES.put("gaming", "20");
        CATEGORIES.put("comedy", "23");
        CATEGORIES.put("entertainment", "24");
        CATEGORIES.put("pets", "15");
    }

    private final ShortsHotVideoRepository repository;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    @Value("${pace.youtube.api-key:}")
    private String apiKey;

    public List<String> categories() {
        return List.copyOf(CATEGORIES.keySet());
    }

    public List<ShortsHotVideoResponse> get(String category) {
        String normalized = CATEGORIES.containsKey(category) ? category : "all";
        return repository.findByCategoryOrderByRankAsc(normalized).stream()
                .map(ShortsHotVideoResponse::of)
                .toList();
    }

    // 매일 새벽 4시(KST, 서버 타임존 기준) 1회 전체 카테고리 갱신 — 트렌드는 하루 단위로도 충분하고,
    // 카테고리당 videos.list 1회(≈1 unit)라 일일 쿼터(기본 10,000 units)에 전혀 부담이 없다.
    @Scheduled(cron = "0 0 4 * * *")
    public void refreshAll() {
        if (apiKey == null || apiKey.isBlank()) {
            log.warn("[ShortsHot] YOUTUBE_API_KEY 미설정 — 갱신 스킵");
            return;
        }
        // "all"은 여기서 직접 API를 부르지 않고, 아래에서 카테고리별 결과를 합쳐 따로 만든다
        // (refreshAllTab 참고) — categoryId==null인 항목이 "all" 하나뿐이라 이걸로 구분한다.
        List<List<ShortsHotVideo>> perCategory = new ArrayList<>();
        CATEGORIES.forEach((category, categoryId) -> {
            if (categoryId == null) return;
            try {
                perCategory.add(refreshCategory(category, categoryId));
            } catch (Exception e) {
                // 카테고리 하나가 실패해도(쿼터 초과, 일시적 네트워크 오류 등) 나머지는 계속 갱신 —
                // 부분 실패가 전체 갱신을 막으면 안 됨. 실패한 카테고리는 기존 캐시가 그대로 유지된다.
                log.error("[ShortsHot] 카테고리 갱신 실패: category={}", category, e);
            }
        });
        refreshAllTab(perCategory);
    }

    // "all" 탭은 별도 API 호출(카테고리 무관 전체 인기차트) 대신, 방금 갱신한 카테고리별 결과를
    // 라운드로빈으로 섞어 만든다 — 2026-08-01 발견: KR 전체 인기차트 상위 50개 중 60초 이하가
    // 하나도 없는 날이 있어(뮤직비디오/방송 클립 등 긴 영상 위주) "all" 탭 전체가 비어 보이는
    // 문제가 있었다. 카테고리별 결과를 합치면 어느 한 카테고리라도 결과가 있는 한 "all"도 채워진다.
    private void refreshAllTab(List<List<ShortsHotVideo>> perCategory) {
        List<ShortsHotVideo> merged = new ArrayList<>();
        Set<String> seenVideoIds = new HashSet<>();
        LocalDateTime now = LocalDateTime.now();
        int rank = 0;
        for (int index = 0; rank < KEEP_COUNT; index++) {
            boolean addedAny = false;
            for (List<ShortsHotVideo> categoryRows : perCategory) {
                if (index >= categoryRows.size()) continue;
                ShortsHotVideo source = categoryRows.get(index);
                if (!seenVideoIds.add(source.getVideoId())) continue;
                merged.add(new ShortsHotVideo("all", rank, source.getVideoId(), source.getTitle(),
                        source.getChannel(), source.getThumbnailUrl(), now));
                rank++;
                addedAny = true;
                if (rank >= KEEP_COUNT) break;
            }
            if (!addedAny) break;
        }
        repository.deleteByCategory("all");
        repository.saveAll(merged);
        log.info("[ShortsHot] category=all(카테고리 집계) 갱신 완료: {}건", merged.size());
    }

    private List<ShortsHotVideo> refreshCategory(String category, String categoryId) throws Exception {
        StringBuilder url = new StringBuilder(VIDEOS_API)
                .append("?part=snippet,contentDetails")
                .append("&chart=mostPopular")
                .append("&regionCode=KR")
                .append("&maxResults=").append(FETCH_COUNT)
                .append("&key=").append(URLEncoder.encode(apiKey, StandardCharsets.UTF_8));
        if (categoryId != null) {
            url.append("&videoCategoryId=").append(categoryId);
        }

        HttpRequest request = HttpRequest.newBuilder(URI.create(url.toString())).GET().build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new IllegalStateException("YouTube API " + response.statusCode() + ": " + response.body());
        }

        JsonNode items = objectMapper.readTree(response.body()).path("items");
        List<ShortsHotVideo> rows = new ArrayList<>();
        LocalDateTime now = LocalDateTime.now();
        int rank = 0;
        for (JsonNode item : items) {
            String duration = item.path("contentDetails").path("duration").asText("");
            if (parseDurationSeconds(duration) > MAX_SHORT_SECONDS) continue;

            String videoId = item.path("id").asText(null);
            JsonNode snippet = item.path("snippet");
            String title = snippet.path("title").asText(null);
            if (videoId == null || title == null) continue;

            String channel = snippet.path("channelTitle").asText(null);
            String thumbnailUrl = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";

            rows.add(new ShortsHotVideo(category, rank, videoId, title, channel, thumbnailUrl, now));
            rank++;
            if (rank >= KEEP_COUNT) break;
        }

        repository.deleteByCategory(category);
        repository.saveAll(rows);
        log.info("[ShortsHot] category={} 갱신 완료: {}건", category, rows.size());
        return rows;
    }

    // ISO-8601 duration(PT#M#S 등)을 초로 변환 — java.time.Duration.parse가 표준을 정확히 처리하므로
    // 정규식 대신 그대로 위임(youtube.ts의 클라이언트 측 정규식 파싱보다 견고함).
    private long parseDurationSeconds(String iso) {
        if (iso.isEmpty()) return Long.MAX_VALUE;
        try {
            return Duration.parse(iso).getSeconds();
        } catch (Exception e) {
            return Long.MAX_VALUE; // 파싱 실패 시 안전하게 "Shorts 아님"으로 제외
        }
    }
}
