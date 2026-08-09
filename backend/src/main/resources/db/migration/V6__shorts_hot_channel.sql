-- 🔴 2026-08-09 사장님 지시 — "20대에서 40대로 제한해서 서버에서 리스트 만들게 해",
--   이어서 "야 검색어는 계속 변하는데 검색어로 변화를 준다고?" (정확한 지적).
--
-- 배경: YouTube Data API에는 **시청자 연령으로 거르는 파라미터가 없다**(지역/주제/언어뿐).
--   그래서 연령대를 대리할 무언가가 필요한데, 검색어는 유행을 타서 몇 주면 낡는다.
--   반면 **연령대는 채널의 속성**이다 — 어떤 채널의 시청자층은 몇 년 단위로 잘 안 바뀐다.
--
-- 그래서 목록의 모집단을 "검색 결과"가 아니라 "우리가 고른 채널들"로 바꾼다.
--   · 평소 갱신: 채널의 업로드 재생목록만 읽는다(playlistItems.list = 1 unit) → 매우 쌈
--   · 채널 명단 갱신: 가끔(명단이 비었을 때만) 검색으로 후보를 뽑아 채운다
--
-- ⚠️ country가 키에 반드시 들어간다 — 사장님 지적("채널도 나라별로 다른거 아냐?")대로 한국 채널을
--   일본/미국 사용자에게 보여주면 안 된다. 기존 shorts_hot_video가 국가별로 나뉜 것과 같은 이유(V5).
--
-- ⚠️⚠️ 이 파일은 처음에 **PostgreSQL 문법(BIGSERIAL, CREATE INDEX IF NOT EXISTS)** 으로 썼다가
--   프로덕션 배포가 통째로 실패했다(Flyway 1064 syntax error → 앱이 못 뜨고 502).
--   **이 프로젝트의 DB는 MySQL이다.** 기존 마이그레이션(V2/V5)이 이미 BIGINT AUTO_INCREMENT와
--   DATETIME을 쓰고 있었는데 그걸 안 보고 새 문법을 쓴 것이 원인이다.
--   새 마이그레이션을 쓸 땐 반드시 기존 파일의 문법을 먼저 확인할 것:
--     · 자동증가 PK  : BIGINT AUTO_INCREMENT PRIMARY KEY  (BIGSERIAL 아님)
--     · 시각          : DATETIME                            (TIMESTAMP도 되지만 기존 스타일에 맞춤)
--     · CREATE INDEX  : MySQL은 IF NOT EXISTS를 지원하지 않는다
CREATE TABLE shorts_hot_channel (
    id            BIGINT       AUTO_INCREMENT PRIMARY KEY,
    country       VARCHAR(2)   NOT NULL,
    category      VARCHAR(32)  NOT NULL,
    channel_id    VARCHAR(64)  NOT NULL,
    channel_title VARCHAR(255) NULL,
    -- 이 채널이 자동 발견에서 몇 번 걸렸는지 — 낮은 채널을 정리할 때 쓴다.
    hit_count     INT          NOT NULL DEFAULT 0,
    -- 사람이 직접 넣은 채널은 자동 정리 대상에서 제외한다(수동 큐레이션 보호).
    pinned        BOOLEAN      NOT NULL DEFAULT FALSE,
    enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
    discovered_at DATETIME     NOT NULL,
    CONSTRAINT uq_shorts_hot_channel UNIQUE (country, category, channel_id)
);

CREATE INDEX idx_shorts_hot_channel_lookup ON shorts_hot_channel (country, category, enabled);
