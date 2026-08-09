-- 🔴 2026-08-09 사장님 지시 — "20대에서 40대로 제한해서 서버에서 리스트 만들게 해",
--   이어서 "야 검색어는 계속 변하는데 검색어로 변화를 준다고?" (정확한 지적).
--
-- 배경: YouTube Data API에는 **시청자 연령으로 거르는 파라미터가 없다**(지역/주제/언어뿐).
--   그래서 연령대를 대리할 무언가가 필요한데, 검색어는 유행을 타서 몇 주면 낡는다.
--   반면 **연령대는 채널의 속성**이다 — 어떤 채널의 시청자층은 몇 년 단위로 잘 안 바뀐다.
--
-- 그래서 목록의 모집단을 "검색 결과"가 아니라 "우리가 고른 채널들"로 바꾼다.
--   · 평소 갱신: 채널의 업로드 재생목록만 읽는다(playlistItems.list = 1 unit) → 매우 쌈
--   · 채널 명단 갱신: 가끔(주 단위) 검색으로 후보를 뽑아 채운다 → 검색어가 낡아도 영향이 제한적
--
-- 쿼터 비교(3국 × 6카테고리 기준):
--   기존 검색 방식  : 6 × 100 = 600 units/국가/회
--   채널 방식      : 채널수 × 1 + 통계(50개당 1) ≈ 50 units/국가/회
--
-- ⚠️ country가 키에 반드시 들어간다 — 사장님 지적("채널도 나라별로 다른거 아냐?")대로 한국 채널을
--   일본/미국 사용자에게 보여주면 안 된다. 기존 shorts_hot 테이블이 국가별로 나뉜 것과 같은 이유.
CREATE TABLE IF NOT EXISTS shorts_hot_channel (
    id              BIGSERIAL PRIMARY KEY,
    country         VARCHAR(2)   NOT NULL,
    category        VARCHAR(32)  NOT NULL,
    channel_id      VARCHAR(64)  NOT NULL,
    channel_title   VARCHAR(255),
    -- 이 채널이 목록에 얼마나 자주 등장했는지(자동 발견 시 누적) — 낮은 채널을 정리할 때 쓴다.
    hit_count       INTEGER      NOT NULL DEFAULT 0,
    -- 사람이 직접 넣은 채널은 자동 정리 대상에서 제외한다(수동 큐레이션 보호).
    pinned          BOOLEAN      NOT NULL DEFAULT FALSE,
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    discovered_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_shorts_hot_channel UNIQUE (country, category, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_shorts_hot_channel_lookup
    ON shorts_hot_channel (country, category, enabled);
