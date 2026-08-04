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
    private static final String SEARCH_API = "https://www.googleapis.com/youtube/v3/search";
    private static final int MAX_SHORT_SECONDS = 60;
    private static final int FETCH_COUNT = 50;
    // 2026-08-01 사장님 지시 — 클라이언트가 "본 영상"을 뒤로 미루는 대신 아예 목록에서 제외하는
    // 방식으로 바뀌면서(PaceOverlayService.ShortsHotStore.fetch 참고), 다 본 카테고리가 쉽게
    // 텅 비지 않도록 확보량을 키움. 2026-08-01(추가 지시) "60초내 50개로 늘려(공통)" → 30→50.
    // search.list는 호출당 정액 비용(maxResults와 무관)이라 이 증가가 쿼터에 미치는 영향은 사실상
    // 없음(아래 SEARCH_FALLBACK_RESULTS 주석 참고). 필터(≤60초·비라이브)는 그대로 유지.
    // 2026-08-04 사장님 결정 — 50 → 25. 주 경로를 "최근 48시간 조회수 순"으로 바꾼 뒤(RECENT_HOURS
    // 주석 참고) 실측해보니, 그 조건에 맞는 후보가 카테고리당 50개를 못 채워서 모자란 만큼을
    // chart=mostPopular(누적 차트, 며칠씩 안 바뀜)가 메웠다 — 결과적으로 50건 중 10건만 갱신되고
    // 상위권에 예전 영상이 그대로 남았다.
    // "목록이 짧아도 오늘 인기가 확실한 것"이 "50개를 채우려고 며칠 된 영상을 섞는 것"보다 낫다는
    // 판단으로 확보량을 줄인다. 그만큼 chart 보충이 개입할 여지가 사라져 목록이 매 갱신마다 실제로 바뀐다.
    private static final int KEEP_COUNT = 25;
    // 2026-08-01 발견 — music/gaming처럼 트렌드가 뮤직비디오/풀 게임플레이 위주인 카테고리는 상위
    // 50개 안에 60초 이하가 하나도 없는 날이 흔했다(music/gaming 탭이 통째로 빈 리스트로 보였음).
    // chart=mostPopular도 다른 목록형 API처럼 nextPageToken으로 더 내려갈 수 있어서, 부족하면
    // 최대 이만큼 더 페이지를 넘겨가며 60초 이하를 찾는다 — 페이지당 1 unit이라 최악의 경우도
    // 카테고리당 몇 units로 쿼터엔 무의미. KEEP_COUNT를 50으로 올린 만큼 4→6페이지로 여유 확보
    // (인기차트에 60초 이하가 드물어 50개를 채우려면 더 깊이 내려가야 함).
    private static final int MAX_PAGES = 6;
    // 2026-08-01 발견 — 페이지를 늘려도 music은 여전히 0건, gaming은 1건뿐이었다(실제로 KR
    // mostPopular 차트 자체에 해당 카테고리 60초 이하 영상이 거의 없음, 인기 뮤비/풀영상 위주라
    // 근본적 한계). chart 기반으로 부족하면 search.list(videoDuration=short)로 보충한다 — 100
    // units/회로 videos.list보다 비싸지만 검색 결과 개수(maxResults)는 비용에 영향 없는 정액 요금이라
    // KEEP_COUNT를 50으로 올린 것에 맞춰 후보 풀도 search.list 최대치(50)로 키움(비용 증가 없음).
    private static final int SEARCH_FALLBACK_RESULTS = 50;

    // 2026-08-04 사장님 지적("인기 쇼츠를 전체로 봐서 그런 거 아냐? 매일 그날 인기 쇼츠 맞아?") —
    // 정확한 지적이었다. 주 경로가 chart=mostPopular였는데 그건 **"그날 인기"가 아니라 유튜브
    // 인기급상승 차트(누적 트렌드)**라 며칠씩 거의 안 바뀐다. 게다가 쇼츠 전용도 아니라 일반 영상이
    // 섞이고(카테고리로만 나눔), 아래 폴백의 order=viewCount도 기간 조건이 없어 **역대 조회수** 순이라
    // 몇 년 된 영상이 계속 1등이었다. 그래서 어제와 같은 목록이 나왔다.
    //
    // → 주 경로를 "최근 N시간 안에 올라온 것 중 조회수 높은 순"으로 바꾼다(publishedAfter + order=viewCount
    //   + videoDuration=short). 그래야 매일 실제로 갱신되는 "그날 인기 쇼츠"가 된다.
    // 24시간은 카테고리에 따라 후보가 모자랄 수 있어 48시간으로 둔다(하루 4회 갱신이라 충분히 신선).
    private static final int RECENT_HOURS = 48;

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

    // search.list는 chart처럼 카테고리ID만으로 못 걸러서 검색어가 필요하다 — 카테고리를 그대로
    // 대표하는 한국어 키워드.
    // 2026-08-04 — "all"을 추가한다. 예전엔 chart=mostPopular가 주 경로라 all은 검색어가 필요 없었지만,
    // 이제 search가 주 경로가 되면서 all에도 대표 검색어가 있어야 한다.
    private static final Map<String, String> SEARCH_FALLBACK_QUERY = Map.of(
            "all", "쇼츠",
            "music", "인기 음악",
            "gaming", "게임",
            "comedy", "웃긴 영상",
            "entertainment", "예능",
            "pets", "반려동물"
    );

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

    // 2026-08-01 사장님 지시로 1일 1회 → 6시간마다(하루 4회)로 단축 — 트렌드 신선도 개선.
    // 카테고리당 최악(search fallback 필요) 105 units × 5개 = 525 units/회, 하루 4회면 최악 약
    // 2,100 units(일일 쿼터 10,000의 ~21%) — 이 키는 클라이언트 Shorts 피드용 키와 별개 전용
    // 키라 다른 기능과 쿼터를 나눠쓰지 않음, 여유 충분.
    @Scheduled(cron = "0 0 0,6,12,18 * * *")
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
        List<ShortsHotVideo> rows = new ArrayList<>();
        LocalDateTime now = LocalDateTime.now();
        String pageToken = null;

        // 2026-08-04 사장님 지적("인기 쇼츠를 전체로 봐서 그런 거 아냐? 매일 그날 인기 쇼츠 맞아?")으로
        // 순서를 뒤집었다 — "최근 RECENT_HOURS 안에 올라온 것 중 조회수 높은 순"을 **주 경로**로 쓴다.
        // chart=mostPopular는 그날 인기가 아니라 누적 인기급상승 차트라 며칠씩 그대로였고, 쇼츠 전용도
        // 아니라 일반 영상이 섞였다(카테고리로만 나눔). 이제 chart는 개수가 모자랄 때의 보충용이다.
        if (SEARCH_FALLBACK_QUERY.containsKey(category)) {
            try {
                searchFallback(category, rows, now);
            } catch (Exception e) {
                // 실패해도 아래 chart 경로로 계속 — 목록이 통째로 비는 것보다 낫다.
                log.warn("[ShortsHot] 최근 인기 검색 실패, chart로 폴백: category={}", category, e);
            }
        }

        for (int page = 0; page < MAX_PAGES && rows.size() < KEEP_COUNT; page++) {
            StringBuilder url = new StringBuilder(VIDEOS_API)
                    .append("?part=snippet,contentDetails")
                    .append("&chart=mostPopular")
                    .append("&regionCode=KR")
                    .append("&maxResults=").append(FETCH_COUNT)
                    .append("&key=").append(URLEncoder.encode(apiKey, StandardCharsets.UTF_8));
            if (categoryId != null) {
                url.append("&videoCategoryId=").append(categoryId);
            }
            if (pageToken != null) {
                url.append("&pageToken=").append(URLEncoder.encode(pageToken, StandardCharsets.UTF_8));
            }

            HttpRequest request = HttpRequest.newBuilder(URI.create(url.toString())).GET().build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                throw new IllegalStateException("YouTube API " + response.statusCode() + ": " + response.body());
            }

            JsonNode body = objectMapper.readTree(response.body());
            JsonNode items = body.path("items");
            for (JsonNode item : items) {
                if (!isPlayableShort(item)) continue;

                String videoId = item.path("id").asText(null);
                JsonNode snippet = item.path("snippet");
                String title = snippet.path("title").asText(null);
                if (videoId == null || title == null) continue;

                String channel = snippet.path("channelTitle").asText(null);
                String thumbnailUrl = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";

                rows.add(new ShortsHotVideo(category, rows.size(), videoId, title, channel, thumbnailUrl, now));
                if (rows.size() >= KEEP_COUNT) break;
            }

            pageToken = body.path("nextPageToken").asText(null);
            if (pageToken == null) break; // 더 넘길 페이지가 없음
        }

        // 2026-08-04 — 예전엔 여기서 searchFallback을 불렀는데, 위에서 주 경로로 이미 돌리므로 제거한다
        // (남겨두면 같은 카테고리에 search.list가 두 번 나가 쿼터만 두 배로 쓴다).

        repository.deleteByCategory(category);
        repository.saveAll(rows);
        log.info("[ShortsHot] category={} 갱신 완료: {}건", category, rows.size());
        return rows;
    }

    // chart=mostPopular로 KEEP_COUNT를 못 채운 카테고리를 search.list(videoDuration=short)로
    // 보충한다 — search.list는 정확한 초 단위 duration을 안 주므로(<4분만 보장) videos.list로
    // 한 번 더 조회해 60초 이하만 최종 채택한다.
    private void searchFallback(String category, List<ShortsHotVideo> rows, LocalDateTime now) throws Exception {
        Set<String> seenVideoIds = new HashSet<>();
        for (ShortsHotVideo row : rows) seenVideoIds.add(row.getVideoId());

        String query = SEARCH_FALLBACK_QUERY.get(category);
        // 2026-08-04 — publishedAfter를 붙인다. 이게 없으면 order=viewCount가 **역대 조회수** 순이라
        // 몇 년 된 영상이 계속 1등이고 목록이 매일 그대로다(사장님 지적 "매일 그날 인기 쇼츠 맞아?").
        // YouTube API는 RFC3339 UTC 형식을 요구한다.
        String publishedAfter = java.time.Instant.now()
                .minus(java.time.Duration.ofHours(RECENT_HOURS))
                .truncatedTo(java.time.temporal.ChronoUnit.SECONDS)
                .toString();
        String searchUrl = SEARCH_API
                + "?part=snippet"
                + "&type=video"
                + "&videoDuration=short"
                + "&order=viewCount"
                + "&publishedAfter=" + URLEncoder.encode(publishedAfter, StandardCharsets.UTF_8)
                + "&regionCode=KR"
                + "&relevanceLanguage=ko"
                + "&maxResults=" + SEARCH_FALLBACK_RESULTS
                + "&q=" + URLEncoder.encode(query, StandardCharsets.UTF_8)
                + "&key=" + URLEncoder.encode(apiKey, StandardCharsets.UTF_8);

        HttpRequest searchRequest = HttpRequest.newBuilder(URI.create(searchUrl)).GET().build();
        HttpResponse<String> searchResponse = httpClient.send(searchRequest, HttpResponse.BodyHandlers.ofString());
        if (searchResponse.statusCode() != 200) {
            throw new IllegalStateException("YouTube search API " + searchResponse.statusCode() + ": " + searchResponse.body());
        }

        List<String> candidateIds = new ArrayList<>();
        for (JsonNode item : objectMapper.readTree(searchResponse.body()).path("items")) {
            String videoId = item.path("id").path("videoId").asText(null);
            if (videoId != null && seenVideoIds.add(videoId)) candidateIds.add(videoId);
        }
        if (candidateIds.isEmpty()) return;

        String detailsUrl = VIDEOS_API
                + "?part=snippet,contentDetails"
                + "&id=" + URLEncoder.encode(String.join(",", candidateIds), StandardCharsets.UTF_8)
                + "&key=" + URLEncoder.encode(apiKey, StandardCharsets.UTF_8);
        HttpRequest detailsRequest = HttpRequest.newBuilder(URI.create(detailsUrl)).GET().build();
        HttpResponse<String> detailsResponse = httpClient.send(detailsRequest, HttpResponse.BodyHandlers.ofString());
        if (detailsResponse.statusCode() != 200) {
            throw new IllegalStateException("YouTube API " + detailsResponse.statusCode() + ": " + detailsResponse.body());
        }

        for (JsonNode item : objectMapper.readTree(detailsResponse.body()).path("items")) {
            if (rows.size() >= KEEP_COUNT) break;
            if (!isPlayableShort(item)) continue;

            String videoId = item.path("id").asText(null);
            JsonNode snippet = item.path("snippet");
            String title = snippet.path("title").asText(null);
            if (videoId == null || title == null) continue;

            String channel = snippet.path("channelTitle").asText(null);
            String thumbnailUrl = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";
            rows.add(new ShortsHotVideo(category, rows.size(), videoId, title, channel, thumbnailUrl, now));
        }
    }

    // 2026-08-01 사장님 지적("쇼츠타입으로 열어야지") — HOT 항목을 탭하면 앱 내 피드가 youtube.com/shorts/{id}
    // 로 여는데, 그 영상이 진짜 Shorts가 아니면 유튜브가 일반 watch 페이지로 리다이렉트해(가로 영상+댓글)
    // "쇼츠타입"이 아니게 보인다. 원인은 라이브 방송/프리미어가 contentDetails.duration을 "P0D"로 반환하는데
    // Duration.parse("P0D")==0초라 60초 이하 필터를 통과해 목록에 섞여 들어온 것(실기기: 로블록스 2일 전
    // 스트리밍이 HOT에 떴다). 진짜 재생 가능한 Shorts만 남기려면 ①라이브/예정(liveBroadcastContent!=none)을
    // 빼고 ②0<길이<=60초만 인정한다(0초=P0D는 Shorts 아님).
    private boolean isPlayableShort(JsonNode item) {
        String live = item.path("snippet").path("liveBroadcastContent").asText("none");
        if (!"none".equals(live)) return false; // 라이브/예정 방송 제외
        long seconds = parseDurationSeconds(item.path("contentDetails").path("duration").asText(""));
        return seconds > 0 && seconds <= MAX_SHORT_SECONDS;
    }

    // ISO-8601 duration(PT#M#S 등)을 초로 변환 — java.time.Duration.parse가 표준을 정확히 처리하므로
    // 정규식 대신 그대로 위임(youtube.ts의 클라이언트 측 정규식 파싱보다 견고함).
    // 반환 0 = 길이 미상/P0D(라이브·프리미어) → 호출부(isPlayableShort)가 Shorts 아님으로 제외.
    private long parseDurationSeconds(String iso) {
        if (iso.isEmpty()) return 0; // 길이 미상 → Shorts 아님(isPlayableShort가 seconds>0 요구)
        try {
            return Duration.parse(iso).getSeconds();
        } catch (Exception e) {
            return 0; // 파싱 실패 시 안전하게 "Shorts 아님"으로 제외
        }
    }
}
