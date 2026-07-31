-- Shorts HOT(오버레이 P 메뉴 "Shorts HOT" 카테고리별 인기 목록) — 사용자별 데이터가 아니라
-- 카테고리별 전역 캐시(모든 사용자가 동일한 목록을 봄)라 user_account를 참조하지 않는다.
-- ShortsHotService가 매일 새벽 YouTube Data API videos.list(chart=mostPopular)로 갱신해서
-- 이 테이블을 채우고, 앱은 조회만 한다(클라이언트가 YouTube API 키를 직접 쓰지 않음).
CREATE TABLE shorts_hot_video (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    category      VARCHAR(32)   NOT NULL,
    rank          INT           NOT NULL,
    video_id      VARCHAR(32)   NOT NULL,
    title         VARCHAR(500)  NOT NULL,
    channel       VARCHAR(255)  NULL,
    thumbnail_url VARCHAR(500)  NOT NULL,
    refreshed_at  DATETIME      NOT NULL,
    CONSTRAINT uq_shorts_hot_video_category_rank UNIQUE (category, rank)
);
CREATE INDEX idx_shorts_hot_video_category ON shorts_hot_video (category);
