package com.pace.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pace.backend.dto.ShortsHotVideoResponse;
import com.pace.backend.entity.ShortsHotChannel;
import com.pace.backend.entity.ShortsHotVideo;
import com.pace.backend.repository.ShortsHotChannelRepository;
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
    // 채널 업로드 재생목록 조회 — 1 unit(검색 100 units 대비 100배 쌈).
    private static final String PLAYLIST_ITEMS_API = "https://www.googleapis.com/youtube/v3/playlistItems";
    // 채널당 최근 몇 개를 후보로 볼지. 한 채널이 목록을 독점하지 않게 제한하는 손잡이이기도 하다.
    private static final int PER_CHANNEL_RECENT = 10;
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

    /** YouTube categoryId → 우리 카테고리 코드. harvestChannel이 역방향으로 쓴다(검색어 없이 분류). */
    private static final Map<String, String> CATEGORY_BY_YOUTUBE_ID = new LinkedHashMap<>();
    static {
        CATEGORIES.forEach((code, ytId) -> {
            if (ytId != null) CATEGORY_BY_YOUTUBE_ID.put(ytId, code);
        });
    }

    // search.list는 chart처럼 카테고리ID만으로 못 걸러서 검색어가 필요하다 — 카테고리를 그대로
    // 대표하는 한국어 키워드.
    // 2026-08-04 — "all"을 추가한다. 예전엔 chart=mostPopular가 주 경로라 all은 검색어가 필요 없었지만,
    // 이제 search가 주 경로가 되면서 all에도 대표 검색어가 있어야 한다.
    // 🔴 2026-08-09 사장님 지시 — "20대에서 40대로 제한해서 서버에서 리스트 만들게 해".
    //   배경: 실기기 HOT 목록에 이찬원 트로트, 1998년 멜론 차트, 전자과 게임, 영어권 강아지 영상이
    //   한 화면에 섞여 나왔다("너무 다양한 연령대 리스트인데").
    //
    //   ⚠️ **YouTube Data API에는 시청자 연령으로 거르는 파라미터가 없다.** 있는 건 지역(regionCode),
    //     주제(videoCategoryId), 언어(relevanceLanguage)뿐이다. chart=mostPopular는 그 지역에서
    //     제일 많이 본 것을 그대로 주므로 전 연령이 섞이는 게 당연하다.
    //     → 서버가 쓸 수 있는 유일한 수단은 **검색어 큐레이션**이다. 아래 질의는 20~40대가 실제로
    //       찾는 표현으로 바꾸고, 그 밖의 연령대로 확 기우는 소재는 제외 연산자(-)로 뺀다
    //       (YouTube 검색은 `-키워드` 제외를 지원한다).
    //   ⚠️ 이건 확률적 조정이지 보장이 아니다. 목록이 다시 기울면 **이 표만 고쳐 배포**하면 되고
    //     앱 업데이트는 필요 없다(이 프로젝트가 정책을 서버에 두는 이유와 같다).
    private static final Map<String, String> SEARCH_FALLBACK_QUERY = Map.of(
            "all", "요즘 뜨는 쇼츠 -키즈 -동요 -트로트",
            "music", "요즘 인기 플레이리스트 -트로트 -동요 -키즈",
            "gaming", "게임 하이라이트 -키즈",
            "comedy", "직장인 공감 유머 -키즈",
            "entertainment", "예능 하이라이트 -트로트",
            "pets", "반려동물 브이로그"
    );

    // 2026-08-04 사장님 결정 — 쇼츠 HOT을 국가별로 나눈다. 아무 국가나 동적으로 만들면 VPN/봇 요청
    // 한 번에 YouTube 쿼터가 날아가므로(search.list 100 units/회) **지원 국가를 화이트리스트로 고정**한다.
    // 목록에 없는 국가는 US(영어)로 폴백한다 — 목록이 비어 보이는 것보다 낫다.
    // 쿼터: 3국 × 6카테고리 × 100 units × 2회/일 = 3,600 units/일(무료 10,000의 36%).
    // 국가를 하나 늘릴 때마다 +1,200 units/일.
    private static final List<String> SUPPORTED_COUNTRIES = List.of("KR", "JP", "US");
    private static final String FALLBACK_COUNTRY = "US";

    // ⚠️ regionCode만 바꾸고 검색어가 한국어면 일본/미국에서 엉뚱한 결과가 나온다 —
    // 국가별 검색어 세트가 반드시 함께 있어야 한다(Vercel 쪽 CATEGORIES_BY_LANG와 같은 이유).
    private static final Map<String, Map<String, String>> QUERY_BY_COUNTRY = Map.of(
            "KR", SEARCH_FALLBACK_QUERY,
            // JP/US도 같은 기준(20~40대)으로 맞춘다 — 한국만 고치면 다른 지역은 그대로 전 연령이 섞인다.
            "JP", Map.of(
                    "all", "話題のショート -キッズ -童謡 -演歌",
                    "music", "最新 プレイリスト -演歌 -童謡",
                    "gaming", "ゲーム ハイライト -キッズ",
                    "comedy", "社会人 あるある -キッズ",
                    "entertainment", "バラエティ 名場面",
                    "pets", "ペット 日常"
            ),
            "US", Map.of(
                    "all", "trending shorts -kids -nursery",
                    "music", "new music playlist -kids",
                    "gaming", "gaming highlights -kids",
                    "comedy", "relatable work humor",
                    "entertainment", "tv show highlights",
                    "pets", "pet vlog"
            )
    );

    // 국가 → YouTube relevanceLanguage. 없으면 영어로.
    private static final Map<String, String> LANG_BY_COUNTRY = Map.of("KR", "ko", "JP", "ja", "US", "en");

    /** 지원 목록에 있으면 그대로, 없으면 US로 폴백. null/빈값도 안전하게 처리. */
    public static String normalizeCountry(String country) {
        if (country == null) return FALLBACK_COUNTRY;
        String upper = country.trim().toUpperCase();
        return SUPPORTED_COUNTRIES.contains(upper) ? upper : FALLBACK_COUNTRY;
    }

    private final ShortsHotVideoRepository repository;
    private final ShortsHotChannelRepository channelRepository;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    @Value("${pace.youtube.api-key:}")
    private String apiKey;

    public List<String> categories() {
        return List.copyOf(CATEGORIES.keySet());
    }

    public List<ShortsHotVideoResponse> get(String country, String category) {
        String normalizedCountry = normalizeCountry(country);
        String normalized = CATEGORIES.containsKey(category) ? category : "all";
        List<ShortsHotVideoResponse> rows = repository
                .findByCountryAndCategoryOrderByRankAsc(normalizedCountry, normalized).stream()
                .map(ShortsHotVideoResponse::of)
                .toList();
        // 🔴 2026-08-10 사장님 지적("쇼츠 핫리스트 유머 게임 안 나오잖아", "다 출시했는데 어쩔거야") —
        //   music/gaming 카테고리가 0건이라 앱에서 탭이 통째로 비어 보였다.
        //   원인은 두 겹이다:
        //     ① 이 두 카테고리는 원래 후보가 귀하다 — 인기 차트에 60초 이하가 거의 없다
        //        (이 파일 위쪽 MAX_PAGES 주석에 "music 0건, gaming 1건" 실측이 이미 남아 있다).
        //     ② 그 상태에서 YouTube가 429(쿼터 소진)를 주자 채울 방법이 사라졌다.
        //   ⚠️ **앱은 이미 출시돼 있어 클라이언트를 고칠 수 없다.** 빈 목록이 그대로 화면에 나간다.
        //     그래서 서버가 마지막 방어선이 된다 — 비어 있으면 `all` 목록으로 대신 채워 보낸다.
        //     "정확한 카테고리"보다 "빈 화면이 아닌 것"이 사용자에게 훨씬 낫고, 실제 데이터가 들어오면
        //     자동으로 원래 카테고리가 이긴다(이 분기는 rows가 빌 때만 탄다).
        if (rows.isEmpty() && !"all".equals(normalized)) {
            List<ShortsHotVideoResponse> fallback = repository
                    .findByCountryAndCategoryOrderByRankAsc(normalizedCountry, "all").stream()
                    .map(ShortsHotVideoResponse::of)
                    .toList();
            if (!fallback.isEmpty()) {
                log.warn("[ShortsHot] {}/{} 비어 있어 all로 대체해 응답: {}건",
                        normalizedCountry, normalized, fallback.size());
                return fallback;
            }
        }
        return rows;
    }

    // 2026-08-01 사장님 지시로 1일 1회 → 6시간마다(하루 4회)로 단축 — 트렌드 신선도 개선.
    // 카테고리당 최악(search fallback 필요) 105 units × 5개 = 525 units/회, 하루 4회면 최악 약
    // 2,100 units(일일 쿼터 10,000의 ~21%) — 이 키는 클라이언트 Shorts 피드용 키와 별개 전용
    // 키라 다른 기능과 쿼터를 나눠쓰지 않음, 여유 충분.
    // 2026-08-04 — 국가가 3개(KR/JP/US)로 늘면서 하루 4회면 7,200 units(무료 10,000의 72%)로 빡빡해진다.
    // 쇼츠 트렌드가 6시간마다 뒤집히지는 않으므로 2회/일로 줄여 3,600 units(36%)로 맞춘다 —
    // 남는 여유로 나중에 국가를 더 늘릴 수 있다(국가당 +1,200 units/일).
    // 🔴 2026-08-09 사장님 승인 — 채널 방식으로 바꾸면서 1회 갱신 비용이 1,800 → 약 160 units가 됐다.
    //   하루 2회는 그 시절(검색 방식) 기준으로 아낀 값이라 이제는 지나치게 보수적이다.
    //   **2시간마다(하루 12회)** 로 당긴다 — 12 × 160 ≈ 1,920 units/일(무료 10,000의 약 19%).
    //   목록이 훨씬 최신이 되고도 예전(3,600)의 절반 수준이다.
    @Scheduled(cron = "0 0 */2 * * *")
    public void refreshAll() {
        if (apiKey == null || apiKey.isBlank()) {
            log.warn("[ShortsHot] YOUTUBE_API_KEY 미설정 — 갱신 스킵");
            return;
        }
        // "all"은 여기서 직접 API를 부르지 않고, 아래에서 카테고리별 결과를 합쳐 따로 만든다
        // (refreshAllTab 참고) — categoryId==null인 항목이 "all" 하나뿐이라 이걸로 구분한다.
        // 2026-08-04 — 지원 국가마다 따로 채운다. 한 국가가 통째로 실패해도 나머지는 계속 간다.
        for (String country : SUPPORTED_COUNTRIES) {
            List<List<ShortsHotVideo>> perCategory = new ArrayList<>();
            CATEGORIES.forEach((category, categoryId) -> {
                if (categoryId == null) return;
                try {
                    perCategory.add(refreshCategory(country, category, categoryId));
                } catch (Exception e) {
                    // 카테고리 하나가 실패해도(쿼터 초과, 일시적 네트워크 오류 등) 나머지는 계속 갱신 —
                    // 부분 실패가 전체 갱신을 막으면 안 됨. 실패한 카테고리는 기존 캐시가 그대로 유지된다.
                    log.error("[ShortsHot] 카테고리 갱신 실패: country={} category={}", country, category, e);
                }
            });
            refreshAllTab(country, perCategory);
        }
    }

    // "all" 탭은 별도 API 호출(카테고리 무관 전체 인기차트) 대신, 방금 갱신한 카테고리별 결과를
    // 라운드로빈으로 섞어 만든다 — 2026-08-01 발견: KR 전체 인기차트 상위 50개 중 60초 이하가
    // 하나도 없는 날이 있어(뮤직비디오/방송 클립 등 긴 영상 위주) "all" 탭 전체가 비어 보이는
    // 문제가 있었다. 카테고리별 결과를 합치면 어느 한 카테고리라도 결과가 있는 한 "all"도 채워진다.
    private void refreshAllTab(String country, List<List<ShortsHotVideo>> perCategory) {
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
                merged.add(new ShortsHotVideo(country, "all", rank, source.getVideoId(), source.getTitle(),
                        source.getChannel(), source.getThumbnailUrl(), now));
                rank++;
                addedAny = true;
                if (rank >= KEEP_COUNT) break;
            }
            if (!addedAny) break;
        }
        // 위 refreshCategory와 같은 이유 — 병합 결과가 비면 기존 all 목록을 지우지 않는다.
        if (merged.isEmpty()) {
            log.warn("[ShortsHot] category=all 병합 결과 0건 — 기존 목록 유지(덮어쓰지 않음)");
            return;
        }
        repository.deleteByCountryAndCategory(country, "all");
        repository.saveAll(merged);
        log.info("[ShortsHot] category=all(카테고리 집계) 갱신 완료: {}건", merged.size());
    }

    private List<ShortsHotVideo> refreshCategory(String country, String category, String categoryId) throws Exception {
        List<ShortsHotVideo> rows = new ArrayList<>();
        LocalDateTime now = LocalDateTime.now();
        String pageToken = null;

        // 2026-08-04 사장님 지적("인기 쇼츠를 전체로 봐서 그런 거 아냐? 매일 그날 인기 쇼츠 맞아?")으로
        // 순서를 뒤집었다 — "최근 RECENT_HOURS 안에 올라온 것 중 조회수 높은 순"을 **주 경로**로 쓴다.
        // chart=mostPopular는 그날 인기가 아니라 누적 인기급상승 차트라 며칠씩 그대로였고, 쇼츠 전용도
        // 아니라 일반 영상이 섞였다(카테고리로만 나눔). 이제 chart는 개수가 모자랄 때의 보충용이다.
        // 🔴 2026-08-09 — **주 경로를 채널 화이트리스트로 바꾼다**(사장님 지시: 20~40대 타겟팅,
        //   그리고 "검색어는 계속 변하는데 검색어로 변화를 준다고?"). 근거·설계는 collectFromChannels 주석 참고.
        //   순서: ① 명단이 비었으면 검색 1회로 채널을 발견해 적재 → ② 그 채널들의 최근 업로드에서
        //   조회수 순으로 목록 구성 → ③ 그래도 모자라면 기존 검색/chart로 보충(목록이 비는 것 방지).
        try {
            // ⚠️ 갱신 주기를 2시간으로 당기면서 생긴 위험 — 어떤 이유로 명단이 계속 비어 있으면
            //   매 갱신마다 검색(100 units × 6카테고리 × 3국 = 1,800)이 나가 하루 21,600 units가 되어
            //   무료 쿼터(10,000)를 터뜨린다. 발견은 (국가,카테고리)당 하루 한 번으로 제한한다.
            if (channelRepository.countByCountryAndCategoryAndEnabledTrue(country, category) == 0
                    && shouldTryDiscovery(country, category)) {
                discoverChannels(country, category);
            }
            collectFromChannels(country, category, rows, now);
        } catch (Exception e) {
            log.warn("[ShortsHot] 채널 기반 수집 실패, 검색/chart로 폴백: country={} category={}", country, category, e);
        }

        // 🔴 2026-08-11 사장님 지시("밤새 리스트 정상될 때까지 수정해") — 진짜 병목은 필터가 아니라
        //   **명단이 얕은 것**이다. 실측: music 채널 4개, comedy 6개, entertainment 5개뿐이라 무엇을
        //   걸러도 같은 채널이 다시 상위를 먹는다(한 채널이 25건 중 10건).
        //   collectFromChannels는 **이미 명단에 있는 채널에서만** 수집하므로 스스로는 절대 넓어지지
        //   않는다(자기제한). 넓히는 유일한 외부 경로가 검색인데 그건 100 units라 비싸고, 오늘은
        //   쿼터도 소진됐다.
        //   → chart(videos.list, 페이지당 1 unit)는 **검색 쿼터를 안 쓰면서** 그 카테고리의 인기
        //     영상을 직접 준다. 목록이 이미 다 찼더라도 한 페이지는 읽어 **채널만 적재**한다.
        //     매 갱신마다 조금씩 명단이 넓어지고, 넓어질수록 조회수 정렬의 모수가 좋아진다.
        //   ⚠️ 비용: 카테고리당 1 unit. 6카테고리 × 3국 × 12회/일 = 216 units/일(무료 10,000의 2%).
        if (categoryId != null) {
            try {
                harvestChannelsFromChart(country, categoryId);
            } catch (Exception e) {
                log.debug("[ShortsHot] 명단 확장(chart) 실패 — 무시: country={} category={}", country, category, e);
            }
        }

        if (rows.size() < KEEP_COUNT && SEARCH_FALLBACK_QUERY.containsKey(category)) {
            try {
                searchFallback(country, category, rows, now);
            } catch (Exception e) {
                // 실패해도 아래 chart 경로로 계속 — 목록이 통째로 비는 것보다 낫다.
                log.warn("[ShortsHot] 최근 인기 검색 실패, chart로 폴백: category={}", category, e);
            }
        }

        for (int page = 0; page < MAX_PAGES && rows.size() < KEEP_COUNT; page++) {
            StringBuilder url = new StringBuilder(VIDEOS_API)
                    .append("?part=snippet,contentDetails")
                    .append("&chart=mostPopular")
                    .append("&regionCode=" + country)
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

                // 🔴 2026-08-10(2차) — 적재를 collectFromChannels에만 넣었더니 **KR music이 안 채워졌다**
                //   (실측: 배포 후에도 채널=1개 그대로). 당연한 결과였다 — 적재는 "수집된 영상"에서
                //   하는데 music은 수집되는 게 0건이라 적재할 원본 자체가 없다. 명단이 비면 영영
                //   비어 있는 자기강화 실패다.
                //   → 이 chart 경로(chart=mostPopular&videoCategoryId=10)는 **검색어 없이** 그 카테고리
                //   인기 영상을 직접 받아오므로, music처럼 명단이 빈 카테고리를 깨우는 유일한 씨앗이다.
                //   여기서 걸린 쇼츠의 채널을 적재하면 다음 갱신부터 collectFromChannels가 돌기 시작한다.
                harvestChannel(country, snippet);
                rows.add(new ShortsHotVideo(country, category, rows.size(), videoId, title, channel, thumbnailUrl, now));
                if (rows.size() >= KEEP_COUNT) break;
            }

            pageToken = body.path("nextPageToken").asText(null);
            if (pageToken == null) break; // 더 넘길 페이지가 없음
        }

        // 2026-08-04 — 예전엔 여기서 searchFallback을 불렀는데, 위에서 주 경로로 이미 돌리므로 제거한다
        // (남겨두면 같은 카테고리에 search.list가 두 번 나가 쿼터만 두 배로 쓴다).

        // 🔴 2026-08-09 사고에서 드러난 결함 — 예전엔 결과가 0건이어도 **지우고 저장**했다.
        //   그래서 YouTube가 429(쿼터 소진)를 주는 순간 그 카테고리가 통째로 비어버렸다
        //   (실제로 music 탭이 0건이 됐다). 새로 못 가져온 것과 "볼 게 없다"는 완전히 다른 상태인데
        //   같은 결과로 처리한 것이다.
        //   → 새 목록이 비면 **기존 목록을 그대로 둔다.** 조금 오래된 목록이 빈 화면보다 낫고,
        //     다음 갱신(2시간마다)에 성공하면 자연히 최신으로 덮인다.
        if (rows.isEmpty()) {
            log.warn("[ShortsHot] category={} 새 목록 0건 — 기존 목록 유지(덮어쓰지 않음)", category);
            return rows;
        }
        repository.deleteByCountryAndCategory(country, category);
        repository.saveAll(rows);
        log.info("[ShortsHot] category={} 갱신 완료: {}건", category, rows.size());
        return rows;
    }

    // chart=mostPopular로 KEEP_COUNT를 못 채운 카테고리를 search.list(videoDuration=short)로
    // 보충한다 — search.list는 정확한 초 단위 duration을 안 주므로(<4분만 보장) videos.list로
    // 한 번 더 조회해 60초 이하만 최종 채택한다.
    private void searchFallback(String country, String category, List<ShortsHotVideo> rows, LocalDateTime now) throws Exception {
        Set<String> seenVideoIds = new HashSet<>();
        for (ShortsHotVideo row : rows) seenVideoIds.add(row.getVideoId());

        String query = QUERY_BY_COUNTRY.getOrDefault(country, SEARCH_FALLBACK_QUERY).get(category);
        // 2026-08-04 — publishedAfter를 붙인다. 이게 없으면 order=viewCount가 **역대 조회수** 순이라
        // 몇 년 된 영상이 계속 1등이고 목록이 매일 그대로다(사장님 지적 "매일 그날 인기 쇼츠 맞아?").
        // 🔴 2026-08-10 — 다만 그 제한이 붙으면 실제로 **0건**이 돌아오는 것을 API 직접 호출로 확인했다
        //   (searchWithWidenedWindow 주석의 실측표 참고). 이 경로도 그때 통째로 죽어 있었다 —
        //   discoverChannels와 동일하게 "좁게 먼저, 0건이면 기간 제한 없이 한 번 더"로 통일한다.
        List<String> candidateIds = new ArrayList<>();
        for (JsonNode item : searchWithWidenedWindow(country, query, SEARCH_FALLBACK_RESULTS)) {
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
            // 검색으로 찾은 것도 채널 명단에 남긴다 — 그래야 다음부터 검색 없이(쿼터 0) 같은 채널을 쓴다.
            harvestChannel(country, snippet);
            rows.add(new ShortsHotVideo(country, category, rows.size(), videoId, title, channel, thumbnailUrl, now));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 채널 기반 수집 (2026-08-09 사장님 지시)
    //
    //  "20대에서 40대로 제한해서 서버에서 리스트 만들게 해" → 그런데 검색어로 하자 사장님이 바로
    //  짚었다: **"검색어는 계속 변하는데 검색어로 변화를 준다고?"** 맞는 말이다.
    //  YouTube API엔 연령 파라미터가 없어 무언가로 대리해야 하는데, 검색어는 유행을 타 몇 주면 낡는다.
    //  **연령대는 채널의 속성**이다 — 채널의 시청자층은 몇 년 단위로 잘 안 바뀐다.
    //
    //  그래서 역할을 나눈다:
    //    · 채널 명단 만들기 = 가끔(명단이 비었을 때만) 검색 1회 — 검색어가 낡아도 영향이 제한적
    //    · 평소 목록 만들기 = 그 채널들의 업로드에서 뽑기 — 트렌드는 채널들이 알아서 따라간다
    //
    //  쿼터: search.list는 100 units인데 playlistItems.list는 **1 unit**이다. 채널 20개 + 통계 몇 번이면
    //  카테고리당 25 units 안쪽 — 기존 검색 1회(100)보다 싸다.
    //  ⚠️ 업로드 재생목록 ID는 채널 ID의 "UC…"를 "UU…"로 바꾼 값이다(YouTube의 고정 규칙) —
    //    channels.list를 따로 부를 필요가 없어 그만큼 또 아낀다.
    // ─────────────────────────────────────────────────────────────────────────

    // (국가|카테고리) → 마지막 채널 발견 시도 시각. 발견은 검색(100 units)이라 자주 돌면 안 된다.
    // 인메모리라 재시작하면 비지만, 그때 한 번 더 시도하는 정도는 쿼터에 무해하다.
    private final Map<String, java.time.Instant> lastDiscoveryAt = new java.util.concurrent.ConcurrentHashMap<>();
    private static final Duration DISCOVERY_MIN_INTERVAL = Duration.ofHours(24);

    // 수동 갱신(POST /shorts-hot/refresh)의 최소 간격. 한 번에 약 160 units가 나가므로 루프 호출을 막는다.
    private static final Duration MANUAL_REFRESH_MIN_INTERVAL = Duration.ofMinutes(10);
    private volatile java.time.Instant lastManualRefreshAt = null;

    /**
     * 수동 갱신. 너무 잦으면 아무것도 안 하고 false를 돌려준다(쿼터 보호).
     * @return 실제로 갱신을 돌렸으면 true
     */
    public synchronized boolean refreshManually() {
        java.time.Instant now = java.time.Instant.now();
        if (lastManualRefreshAt != null
                && Duration.between(lastManualRefreshAt, now).compareTo(MANUAL_REFRESH_MIN_INTERVAL) < 0) {
            log.info("[ShortsHot] 수동 갱신 스로틀 — 마지막 실행 후 {}분 미만", MANUAL_REFRESH_MIN_INTERVAL.toMinutes());
            return false;
        }
        lastManualRefreshAt = now;
        refreshAll();
        return true;
    }

    /** 같은 (국가,카테고리)에 대해 하루 한 번만 발견을 시도하게 막는다(쿼터 폭주 방지). */
    private boolean shouldTryDiscovery(String country, String category) {
        String key = country + "|" + category;
        java.time.Instant last = lastDiscoveryAt.get(key);
        if (last != null && Duration.between(last, java.time.Instant.now()).compareTo(DISCOVERY_MIN_INTERVAL) < 0) {
            return false;
        }
        lastDiscoveryAt.put(key, java.time.Instant.now());
        return true;
    }

    /** 채널 ID(UC…) → 업로드 재생목록 ID(UU…). 규칙 변환이라 API 호출이 0이다. */
    private String uploadsPlaylistId(String channelId) {
        if (channelId == null || !channelId.startsWith("UC") || channelId.length() < 3) return null;
        return "UU" + channelId.substring(2);
    }

    /**
     * 명단이 비어 있을 때만 검색 1회로 채널 후보를 채운다(카테고리당 100 units, 최초/드묾).
     * 검색 결과의 **영상**이 아니라 그 영상을 올린 **채널**만 가져간다 — 검색어의 유행성이 목록에
     * 매일 반영되지 않게 하기 위함이다.
     */
    /**
     * 🔴 2026-08-10 사장님 지적("음악 게임 리스트 못 뽑고 소스 못 고치니까 백엔드만 임시로 수정했잖아")
     *   — 맞는 지적이었고, 진짜 원인을 실제 API 호출로 확정했다.
     *
     *   같은 검색을 파라미터만 바꿔가며 직접 쏴본 결과(regionCode=KR, q="게임 하이라이트"):
     *       publishedAfter=48시간 전       → totalResults 0
     *       publishedAfter=7/30/90/180일 전 → 0
     *       publishedAfter=365일 전         → 2
     *       publishedAfter **제거**         → 22
     *   즉 `publishedAfter`가 붙는 순간 0이 된다(order를 date/relevance로 바꿔도 동일, videoDuration을
     *   빼도 동일). 그래서 **채널 발견이 모든 카테고리에서 실패**하고 있었다.
     *   gaming이 멀쩡해 보인 건 예전에 채널이 적재돼 있어 collectFromChannels가 도는 것뿐이고,
     *   명단이 빈 music은 영영 못 채운다 → 빈 목록 → 2026-08-10의 "카테고리가 비면 all로 대체"
     *   폴백이 매번 발동. 사장님이 Music 탭에서 음악이 아닌 목록을 보신 것이 정확히 이것이다
     *   (실기기 확인: Gaming은 진짜 게이밍 콘텐츠, Music은 All과 완전히 동일한 목록).
     *
     *   publishedAfter를 넣은 원래 의도(2026-08-04 "매일 그날 인기 쇼츠 맞아?")는 유효하므로 버리지
     *   않는다 — **먼저 좁게 시도하고, 0건이면 기간 제한 없이 한 번 더** 쏜다. 목록이 통째로 비는
     *   것보다 조금 덜 신선한 편이 낫다는 이 파일의 기존 폴백 원칙과 같다.
     *   ⚠️ 쿼터: 0건일 때만 1회 추가(search.list 100 units). 발견은 (국가,카테고리)당 하루 1회로
     *     이미 제한돼 있다(shouldTryDiscovery).
     */
    private JsonNode searchWithWidenedWindow(String country, String query, int maxResults) throws Exception {
        String publishedAfter = java.time.Instant.now()
                .minus(java.time.Duration.ofHours(RECENT_HOURS))
                .truncatedTo(java.time.temporal.ChronoUnit.SECONDS)
                .toString();
        JsonNode items = runSearch(country, query, maxResults, publishedAfter);
        if (items.size() > 0) return items;
        log.warn("[ShortsHot] 검색 0건(publishedAfter={}) — 기간 제한 없이 재시도: country={} q={}",
                publishedAfter, country, query);
        return runSearch(country, query, maxResults, null);
    }

    private JsonNode runSearch(String country, String query, int maxResults, String publishedAfter) throws Exception {
        String url = SEARCH_API
                + "?part=snippet&type=video&videoDuration=short&order=viewCount"
                + (publishedAfter != null
                        ? "&publishedAfter=" + URLEncoder.encode(publishedAfter, StandardCharsets.UTF_8)
                        : "")
                + "&regionCode=" + country
                + "&relevanceLanguage=" + LANG_BY_COUNTRY.getOrDefault(country, "en")
                + "&maxResults=" + maxResults
                + "&q=" + URLEncoder.encode(query, StandardCharsets.UTF_8)
                + "&key=" + URLEncoder.encode(apiKey, StandardCharsets.UTF_8);
        HttpResponse<String> res = httpClient.send(
                HttpRequest.newBuilder(URI.create(url)).GET().build(), HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) {
            throw new IllegalStateException("YouTube search API " + res.statusCode() + ": " + res.body());
        }
        return objectMapper.readTree(res.body()).path("items");
    }

    private void discoverChannels(String country, String category) throws Exception {
        String query = QUERY_BY_COUNTRY.getOrDefault(country, SEARCH_FALLBACK_QUERY).get(category);
        if (query == null) return;
        int added = 0;
        for (JsonNode item : searchWithWidenedWindow(country, query, SEARCH_FALLBACK_RESULTS)) {
            String channelId = item.path("snippet").path("channelId").asText(null);
            String channelTitle = item.path("snippet").path("channelTitle").asText(null);
            if (channelId == null || uploadsPlaylistId(channelId) == null) continue;
            var existing = channelRepository.findByCountryAndCategoryAndChannelId(country, category, channelId);
            if (existing.isPresent()) {
                var ch = existing.get();
                ch.setHitCount(ch.getHitCount() + 1);
                channelRepository.save(ch);
            } else {
                channelRepository.save(ShortsHotChannel.builder()
                        .country(country).category(category)
                        .channelId(channelId).channelTitle(channelTitle)
                        .hitCount(1).pinned(false).enabled(true)
                        .discoveredAt(LocalDateTime.now())
                        .build());
                added++;
            }
        }
        log.info("[ShortsHot] 채널 발견: country={} category={} 신규={}건", country, category, added);
    }

    /**
     * 화이트리스트 채널들의 최근 업로드에서 목록을 만든다.
     * 채널 방식의 기본은 "최신순"이라 그대로 쓰면 품질 편차가 크다 — 그래서 최근 업로드를 모은 뒤
     * **조회수로 재정렬**해서 "최근 것 중 인기순"으로 만든다(사장님 질문 "최신 리스트야 인기 리스트야"의 답).
     */
    private void collectFromChannels(String country, String category, List<ShortsHotVideo> rows, LocalDateTime now)
            throws Exception {
        List<ShortsHotChannel> channels = channelRepository.findByCountryAndCategoryAndEnabledTrue(country, category);
        if (channels.isEmpty()) return;

        // 1) 채널별 최근 업로드 ID 모으기 (채널당 1 unit)
        List<String> candidateIds = new ArrayList<>();
        for (ShortsHotChannel ch : channels) {
            String playlistId = uploadsPlaylistId(ch.getChannelId());
            if (playlistId == null) continue;
            try {
                String url = PLAYLIST_ITEMS_API
                        + "?part=contentDetails&maxResults=" + PER_CHANNEL_RECENT
                        + "&playlistId=" + URLEncoder.encode(playlistId, StandardCharsets.UTF_8)
                        + "&key=" + URLEncoder.encode(apiKey, StandardCharsets.UTF_8);
                HttpResponse<String> res = httpClient.send(
                        HttpRequest.newBuilder(URI.create(url)).GET().build(), HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() != 200) continue; // 채널 하나 실패로 전체를 망치지 않는다
                for (JsonNode it : objectMapper.readTree(res.body()).path("items")) {
                    String vid = it.path("contentDetails").path("videoId").asText(null);
                    if (vid != null) candidateIds.add(vid);
                }
            } catch (Exception e) {
                log.warn("[ShortsHot] 채널 업로드 조회 실패: {} ({})", ch.getChannelId(), e.toString());
            }
        }
        if (candidateIds.isEmpty()) return;

        // 2) 통계·길이를 한꺼번에 받아 Shorts만 남기고 조회수로 정렬 (50개당 1 unit)
        record Scored(ShortsHotVideo video, long views) {}
        List<Scored> scored = new ArrayList<>();
        for (int i = 0; i < candidateIds.size(); i += 50) {
            List<String> batch = candidateIds.subList(i, Math.min(i + 50, candidateIds.size()));
            String url = VIDEOS_API
                    // topicDetails 추가 — 유튜브가 분석해 붙이는 주제 분류(matchesTopicOrCategory 참고).
                    // videos.list는 part를 늘려도 1 unit이라 쿼터 비용이 늘지 않는다.
                    + "?part=snippet,contentDetails,statistics,topicDetails"
                    + "&id=" + URLEncoder.encode(String.join(",", batch), StandardCharsets.UTF_8)
                    + "&key=" + URLEncoder.encode(apiKey, StandardCharsets.UTF_8);
            HttpResponse<String> res = httpClient.send(
                    HttpRequest.newBuilder(URI.create(url)).GET().build(), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) continue;
            for (JsonNode item : objectMapper.readTree(res.body()).path("items")) {
                if (!isPlayableShort(item)) continue;
                String videoId = item.path("id").asText(null);
                JsonNode snippet = item.path("snippet");
                String title = snippet.path("title").asText(null);
                if (videoId == null || title == null) continue;
                // 🔴 2026-08-11 사장님 지적("핫 쇼츠 리스트 음악이 음악이 아닌데") — 실측하니 KR music이
                //   betterHOME/도넛펭귄 두 채널로 도배됐고 "완벽했던 알리바이의 최후"처럼 음악과 무관한
                //   것까지 섞였다. 원인은 이 수집이 **채널 단위**로만 돌기 때문이다: 음악 태그 영상 하나로
                //   채널이 명단에 들어오면 그 채널의 **다른 카테고리 업로드까지 전부** 이 탭에 쏟아진다.
                //   채널은 한 카테고리만 올리지 않는다 — 명단은 "후보를 어디서 길어올지"일 뿐이고
                //   카테고리 일치는 **영상 단위로** 확정해야 한다.
                //   이 응답에 이미 snippet.categoryId가 있으므로 추가 호출·쿼터 없이 걸러낼 수 있다.
                //   2026-08-11(2차) — categoryId만으로는 못 거른다(업로더가 고르는 값이라 예능 클립
                //   채널이 Music으로 태깅한다). 유튜브가 분석해 붙이는 topicCategories를 우선 쓴다.
                if (!matchesTopicOrCategory(category, item)) continue;
                long views = item.path("statistics").path("viewCount").asLong(0);
                String thumb = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";
                // 🔴 2026-08-10 사장님 지적("키워드가 그게 최선이야?", "쇼츠 검색 키워드 다 문제 아냐?")
                //   — 맞다. 채널 발견이 **검색어**에만 의존하는 게 구조적 약점이었다. V6에서 목록의
                //   모집단을 검색에서 채널로 옮긴 이유가 "검색어는 계속 변한다"였는데, 정작 그 채널
                //   명단을 채우는 일은 여전히 검색어가 하고 있었다. KR music이 안 차던 것도 결국
                //   "요즘 인기 플레이리스트"가 롱폼을 가리키는 말이라 videoDuration=short와 어긋난 탓이다.
                //   → 여기서 **공짜로** 명단을 채운다. 이 응답에는 이미 snippet.categoryId가 들어 있고
                //   (part=snippet을 이미 받고 있다) 이 영상은 방금 isPlayableShort를 통과한 진짜 쇼츠다.
                //   즉 "이 채널은 이 카테고리의 쇼츠를 실제로 올린다"가 **검색어 없이 데이터로 증명**된다.
                //   추가 API 호출이 0이라 쿼터도 안 쓴다.
                //   ⚠️ 적재는 명단에만 한다 — 이 영상이 목록에 오를지는 아래 조회수 정렬이 따로 정한다
                //     (사장님 확인 "적재 후에 또 거른다며 조회수로"). 명단이 넓어질수록 그 정렬의
                //     모수가 좋아지는 구조다.
                harvestChannel(country, snippet);
                scored.add(new Scored(new ShortsHotVideo(country, category, 0, videoId, title,
                        snippet.path("channelTitle").asText(null), thumb, now), views));
            }
        }
        scored.sort((a, b) -> Long.compare(b.views(), a.views()));
        // 🔴 2026-08-11 사장님 지적("게임도 안 맞는 거 아냐?") — 내용은 게임이 맞았지만 목록이
        //   한 채널로 쏠려 있었다. 실측(KR gaming 25건): kt Rolster 8 / 클로에 하는 니나 6 /
        //   투 마 5 / 빈쒸 4 — 6채널뿐이고 상위 4개가 23건이었다. 더 나쁜 건 "마스터이 하이라이트
        //   106, 107, 108, 109, 110"처럼 **같은 시리즈가 연속 5건** 들어간 것이다. 그건 "지금 뜨는
        //   쇼츠"가 아니라 한 채널의 업로드 목록이다.
        //   원인은 조회수 정렬만 하기 때문이다 — 구독자 많은 채널의 최근 업로드가 통째로 상위를 먹는다.
        //   → 채널당 상한을 둔다. 상한을 채운 채널은 건너뛰고 다음 채널로 넘어간다.
        //   ⚠️ 상한 때문에 KEEP_COUNT를 못 채울 수 있다. 그때는 2차 통과에서 상한을 무시하고 채운다 —
        //     목록이 비는 것보다 쏠린 목록이 낫다는 이 파일의 기존 원칙(빈 탭 방지)과 같은 판단이다.
        final int perChannelCap = Math.max(2, KEEP_COUNT / 6);
        Map<String, Integer> perChannel = new java.util.HashMap<>();
        for (Scored s : scored) {
            if (rows.size() >= KEEP_COUNT) break;
            if (!seenVideoIdsAdd(rows, s.video().getVideoId())) continue;
            String ch = s.video().getChannel() == null ? "" : s.video().getChannel();
            if (perChannel.getOrDefault(ch, 0) >= perChannelCap) continue;
            perChannel.merge(ch, 1, Integer::sum);
            s.video().setRank(rows.size());
            rows.add(s.video());
        }
        // 2차 — 상한 때문에 모자라면 채운다. 다만 **상한을 통째로 무시하지는 않는다**:
        // 2026-08-11 실측에서 1차가 후보 부족으로 거의 못 채우자 2차가 대부분을 채워 쏠림이 그대로
        // 돌아왔다(comedy 최다 9, entertainment 최다 10). 완화된 상한(2배)까지만 허용한다.
        final int relaxedCap = perChannelCap * 2;
        for (Scored s : scored) {
            if (rows.size() >= KEEP_COUNT) break;
            if (!seenVideoIdsAdd(rows, s.video().getVideoId())) continue;
            String ch = s.video().getChannel() == null ? "" : s.video().getChannel();
            if (perChannel.getOrDefault(ch, 0) >= relaxedCap) continue;
            perChannel.merge(ch, 1, Integer::sum);
            s.video().setRank(rows.size());
            rows.add(s.video());
        }
        log.info("[ShortsHot] 채널 수집: country={} category={} 채널={}개 후보={}건 채택={}건",
                country, category, channels.size(), candidateIds.size(), rows.size());
    }

    /**
     * 명단 확장 전용 — chart에서 그 카테고리 인기 쇼츠를 한 페이지 읽어 **채널만** 적재한다.
     * 목록(rows)에는 손대지 않는다. 호출부 주석에 근거/비용이 있다.
     */
    private void harvestChannelsFromChart(String country, String categoryId) throws Exception {
        String url = VIDEOS_API
                + "?part=snippet,contentDetails"
                + "&chart=mostPopular"
                + "&regionCode=" + country
                + "&videoCategoryId=" + categoryId
                + "&maxResults=" + FETCH_COUNT
                + "&key=" + URLEncoder.encode(apiKey, StandardCharsets.UTF_8);
        HttpResponse<String> res = httpClient.send(
                HttpRequest.newBuilder(URI.create(url)).GET().build(), HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) return;
        long before = channelRepository.countByCountryAndCategoryAndEnabledTrue(
                country, CATEGORY_BY_YOUTUBE_ID.getOrDefault(categoryId, ""));
        for (JsonNode item : objectMapper.readTree(res.body()).path("items")) {
            // ⚠️ 2026-08-11 실측 — 처음엔 isPlayableShort를 통과한 것만 적재했는데 **한 채널도 안
            //   늘었다**. chart=mostPopular에는 60초 이하가 거의 없기 때문이다(이 파일 MAX_PAGES
            //   주석에 "music 0건, gaming 1건" 실측이 이미 있었는데 그걸 놓쳤다).
            //   여기서 필요한 건 "쇼츠인 영상"이 아니라 **"그 카테고리에서 활동하는 채널"**이다.
            //   그 채널이 쇼츠를 올리는지는 collectFromChannels가 업로드 재생목록을 읽어 60초 이하로
            //   거를 때 판정된다 — 즉 쇼츠 필터는 뒤에 이미 있다. 여기서 또 걸 이유가 없다.
            //   ⚠️ 쇼츠를 안 올리는 채널이 섞이면 playlistItems 1 unit이 헛돌지만, 명단이 얕아
            //     목록이 쏠리는 손해가 훨씬 크다. hitCount로 나중에 정리할 수 있다(스키마에 이미 있음).
            harvestChannel(country, item.path("snippet"));
        }
        long after = channelRepository.countByCountryAndCategoryAndEnabledTrue(
                country, CATEGORY_BY_YOUTUBE_ID.getOrDefault(categoryId, ""));
        if (after > before) {
            log.info("[ShortsHot] 명단 확장: country={} categoryId={} {}개 → {}개", country, categoryId, before, after);
        }
    }

    /**
     * 이 영상이 해당 탭의 카테고리와 실제로 일치하는지(유튜브가 붙인 snippet.categoryId 기준).
     * "all"은 카테고리 개념이 없으므로 항상 통과시킨다.
     *
     * 채널 화이트리스트는 "후보를 어디서 길어올지"를 정할 뿐이고, 그 채널이 그 카테고리만
     * 올린다는 보장은 없다 — 카테고리 일치는 반드시 영상 단위로 확정해야 한다(위 호출부 주석 참고).
     */
    private boolean matchesCategory(String category, JsonNode snippet) {
        String wanted = CATEGORIES.get(category);
        if (wanted == null) return true; // "all"
        return wanted.equals(snippet.path("categoryId").asText(null));
    }

    /**
     * 🔴 2026-08-11 사장님 지적("음악이 음악이 아닌데") — categoryId 필터를 넣어도 KR music이
     *   그대로였다. 실기기·API로 확인한 이유: **categoryId는 업로더가 직접 고르는 값**이고,
     *   한국 예능 클립 채널들이 노출을 노리고 자기 영상을 Music(10)으로 태깅한다. 유튜브 기준으로도
     *   "Music"이라 categoryId로는 원천적으로 구분이 안 된다.
     *
     *   같은 영상들의 topicDetails를 떠보니 갈렸다:
     *     "태양의 명언에 지디…"    categoryId=10 / topics = Entertainment, Humour
     *     "완벽했던 알리바이의 최후" categoryId=10 / topics = Humour
     *   `topicCategories`는 **유튜브가 콘텐츠를 분석해 붙이는 값**이라 업로더가 마음대로 못 바꾼다.
     *   그래서 이쪽을 우선 신호로 쓴다.
     *
     * ⚠️ topicDetails가 아예 없는 영상도 많다(위 4건 중 2건). 그때까지 버리면 목록이 비므로
     *   **있을 때만** 판정하고, 없으면 categoryId 판정으로 넘어간다(과잉 필터로 탭을 비우지 않는다).
     */
    private static final Map<String, String> TOPIC_KEYWORD = Map.of(
            "music", "music",      // Music, Pop_music, Hip_hop_music, Rock_music ...
            "gaming", "game",      // Video_game_culture, Action_game, Strategy_video_game ...
            "comedy", "humour",    // Humour
            "pets", "pet"          // Pet
            // entertainment는 키워드를 두지 않는다 — Entertainment 토픽이 워낙 넓게 붙어(위 예능
            // 클립들도 Entertainment였다) 변별력이 없고, 오히려 다른 탭의 잔재를 끌어온다.
    );

    /** topicCategories가 있으면 그것으로, 없으면 categoryId로 판정한다(위 주석 참고). */
    private boolean matchesTopicOrCategory(String category, JsonNode item) {
        JsonNode topics = item.path("topicDetails").path("topicCategories");
        String keyword = TOPIC_KEYWORD.get(category);
        if (keyword != null && topics.isArray() && topics.size() > 0) {
            for (JsonNode t : topics) {
                if (t.asText("").toLowerCase(java.util.Locale.US).contains(keyword)) return true;
            }
            return false; // 토픽이 있는데 하나도 안 맞으면 이 탭 것이 아니다
        }
        return matchesCategory(category, item.path("snippet"));
    }

    /**
     * 방금 확인된 "진짜 쇼츠" 한 건에서 그 채널을 카테고리 화이트리스트에 적재한다(추가 API 호출 0).
     * 검색어가 아니라 **유튜브가 붙인 categoryId**로 분류하므로 유행어와 무관하게 명단이 쌓인다.
     * 이미 있으면 hitCount만 올린다(자동 정리 시 낮은 채널부터 걷어내는 기준).
     */
    private void harvestChannel(String country, JsonNode snippet) {
        try {
            String channelId = snippet.path("channelId").asText(null);
            String categoryId = snippet.path("categoryId").asText(null);
            if (channelId == null || categoryId == null) return;
            String category = CATEGORY_BY_YOUTUBE_ID.get(categoryId);
            if (category == null) return; // 우리가 안 쓰는 카테고리(교육/뉴스 등)는 무시
            channelRepository.findByCountryAndCategoryAndChannelId(country, category, channelId)
                    .ifPresentOrElse(ch -> {
                        ch.setHitCount(ch.getHitCount() + 1);
                        channelRepository.save(ch);
                    }, () -> channelRepository.save(ShortsHotChannel.builder()
                            .country(country).category(category)
                            .channelId(channelId).channelTitle(snippet.path("channelTitle").asText(null))
                            .hitCount(1).pinned(false).enabled(true)
                            .discoveredAt(LocalDateTime.now())
                            .build()));
        } catch (Exception e) {
            // 명단 적재는 부가 작업 — 실패해도 목록 갱신 자체는 계속돼야 한다.
            log.debug("[ShortsHot] 채널 적재 실패(무시)", e);
        }
    }

    /** rows에 이미 같은 videoId가 있으면 false(중복 방지) — 채널 간 중복 업로드 대비. */
    private boolean seenVideoIdsAdd(List<ShortsHotVideo> rows, String videoId) {
        for (ShortsHotVideo r : rows) if (r.getVideoId().equals(videoId)) return false;
        return true;
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

    /**
     * FAV-1 (2026-08-17) — 화면에서 읽은 제목/채널로 영상 하나를 특정한다.
     *
     * 안드로이드는 재생 중인 영상의 주소를 앱 밖으로 안 내놓는다(ShortsHotController.resolve 주석).
     * 접근성 트리로 읽히는 건 제목과 채널뿐이라, 그 둘로 유튜브에서 되찾는다.
     * 정확도를 위해 두 가지를 건다:
     *   1) 검색어에 채널명을 함께 넣어 같은 제목의 다른 영상이 섞일 확률을 낮춘다.
     *   2) 결과 중 **채널명이 일치하는 것**을 우선 고른다. 없으면 첫 결과로 폴백한다.
     * 못 찾으면 null을 돌려준다 — 호출부(앱)가 기존 수동 안내로 떨어지게 한다.
     */
    public ShortsHotVideoResponse resolveByTitle(String title, String channel) {
        if (apiKey == null || apiKey.isBlank()) return null;
        if (title == null || title.isBlank()) return null;
        try {
            String q = channel == null || channel.isBlank() ? title : title + " " + channel;
            String url = SEARCH_API
                    + "?part=snippet&type=video&maxResults=5"
                    + "&q=" + URLEncoder.encode(q, StandardCharsets.UTF_8)
                    + "&key=" + URLEncoder.encode(apiKey, StandardCharsets.UTF_8);
            HttpRequest req = HttpRequest.newBuilder(URI.create(url)).GET().build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                log.warn("resolveByTitle YouTube API {}: {}", res.statusCode(), res.body());
                return null;
            }
            // 2026-08-17 실측 — 첫 결과 폴백은 위험하다. "한우 갈비 마늘쫑 비빔밥"을 찾게 했더니
            //   "How to Pronounce Danish Letters"가 나왔다. 아무거나 돌려주면 사용자 즐겨찾기에
            //   전혀 상관없는 영상이 저장된다. 못 찾으면 null을 주고 앱이 수동 안내로 떨어지게 한다.
            ShortsHotVideoResponse titleMatch = null;
            for (JsonNode item : objectMapper.readTree(res.body()).path("items")) {
                String vid = item.path("id").path("videoId").asText(null);
                if (vid == null || vid.isBlank()) continue;
                JsonNode sn = item.path("snippet");
                String t = sn.path("title").asText("");
                String ch = sn.path("channelTitle").asText("");
                String thumb = sn.path("thumbnails").path("high").path("url").asText(null);
                ShortsHotVideoResponse cand = new ShortsHotVideoResponse(vid, t, ch, thumb);
                // 제목이 실제로 겹치는지 확인 — 검색이 엉뚱한 걸 줘도 걸러진다.
                if (titleMatch == null && looksSameTitle(t, title)) titleMatch = cand;
                if (channel != null && !channel.isBlank() && ch.equalsIgnoreCase(channel.trim())) {
                    return cand; // 채널까지 일치 — 가장 신뢰할 수 있는 결과
                }
            }
            return titleMatch;
        } catch (Exception e) {
            log.warn("resolveByTitle 실패 title={} channel={}", title, channel, e);
            return null;
        }
    }

    /** 검색 결과 제목이 화면에서 읽은 제목과 같은 영상인지 — 접두 일치 또는 포함으로 느슨하게 본다. */
    private static boolean looksSameTitle(String found, String wanted) {
        if (found == null || wanted == null) return false;
        String a = found.trim().toLowerCase();
        String b = wanted.trim().toLowerCase();
        if (a.isBlank() || b.isBlank()) return false;
        return a.contains(b) || b.contains(a);
    }
}