-- PACE_ARCHITECTURE.md "백엔드 스택 확정" 섹션과 1:1 대응.
-- Privacy First: 영상 제목/URL/썸네일/좋아요/댓글 등 콘텐츠 식별 정보는 어떤 테이블에도 두지 않는다.

CREATE TABLE user_account (
    id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
    email              VARCHAR(255) NULL,
    name               VARCHAR(255) NULL,
    provider           VARCHAR(32)  NOT NULL,
    device_id          VARCHAR(255) NULL,
    premium            BOOLEAN      NOT NULL DEFAULT FALSE,
    premium_expires_at DATETIME     NULL,
    token_version      INT          NOT NULL DEFAULT 0,
    created_at         DATETIME     NOT NULL,
    updated_at         DATETIME     NOT NULL,
    CONSTRAINT uq_user_account_email UNIQUE (email),
    CONSTRAINT uq_user_account_device_id UNIQUE (device_id)
);

-- 컬럼명은 로컬 SQLite(src/store/useSettingsStore.ts, src/types/models.ts)의 UserSettings 필드명을
-- 그대로 따른다 — 프론트가 이미 실제 UI/SQLite와 연결된 진실원천이고 백엔드가 뒤늦게 맞추는 쪽이므로.
-- app_shields_json/per_app_json: 처음엔 "다기기 동기화 불필요"로 로컬 전용 보류했으나, 실제로 settings.tsx가
-- 이 두 필드로 앱별 토글 UI를 직접 그리고 있어(기기 교체 시 동기화 기대) 서버 미러로 승격.
CREATE TABLE user_settings (
    user_id                 BIGINT PRIMARY KEY,
    auto_next               BOOLEAN  NOT NULL DEFAULT TRUE,
    sleep_timer_minutes     INT      NULL,
    daily_limit_minutes     INT      NOT NULL DEFAULT 60,
    break_interval_minutes  INT      NOT NULL DEFAULT 20,
    pre_session_breathing   BOOLEAN  NOT NULL DEFAULT TRUE,
    app_shields_json        VARCHAR(1000) NULL,
    per_app_json            VARCHAR(2000) NULL,
    theme                   VARCHAR(16) NOT NULL DEFAULT 'system',
    language                VARCHAR(16) NOT NULL DEFAULT 'system',
    updated_at              DATETIME NOT NULL,
    CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES user_account (id) ON DELETE CASCADE
);

-- id는 클라이언트(SQLite sessionsRepository)가 이미 생성한 UUID를 그대로 PK로 재사용한다 —
-- '세션 시작 즉시 push'와 '오프라인 기록 후 일괄 sync' 두 경로가 같은 행에 충돌 없이 합류하도록.
CREATE TABLE viewing_session (
    id                VARCHAR(36) PRIMARY KEY,
    user_id           BIGINT       NOT NULL,
    platform          VARCHAR(32)  NULL,
    started_at        DATETIME     NOT NULL,
    ended_at          DATETIME     NULL,
    duration_seconds  INT          NOT NULL DEFAULT 0,
    videos_watched    INT          NOT NULL DEFAULT 0,
    auto_next_used    BOOLEAN      NOT NULL DEFAULT FALSE,
    -- 'completed' | 'daily_limit_reached' | 'sleep_timer_expired' | 'manual_stop'
    -- 로컬 SQLite(database/schema.ts)가 이미 만드는 소문자 snake_case 값을 그대로 저장한다 —
    -- 서버가 대문자 enum으로 변환하지 않아 클라이언트-서버 간 변환 계층이 필요 없다.
    status            VARCHAR(32)  NULL,
    created_at        DATETIME     NOT NULL,
    CONSTRAINT fk_viewing_session_user FOREIGN KEY (user_id) REFERENCES user_account (id) ON DELETE CASCADE
);
CREATE INDEX idx_viewing_session_user_started ON viewing_session (user_id, started_at);

-- focus_score는 넣지 않는다 — 로컬 SQLite/스토어 어디에도 산출 로직·UI가 없는 "서버가 먼저 만든 개념"이라
-- 허상 데이터가 될 뻔했다(2026-07-18 프론트 실제 구조 대조 후 제거). longest_session_seconds는 로컬
-- daily_stats(schema.ts)에 이미 있는 컬럼이라 그대로 채택.
CREATE TABLE daily_stats (
    id                        BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id                   BIGINT   NOT NULL,
    stat_date                 DATE     NOT NULL,
    total_minutes             INT      NOT NULL DEFAULT 0,
    total_videos              INT      NOT NULL DEFAULT 0,
    session_count             INT      NOT NULL DEFAULT 0,
    longest_session_seconds   INT      NOT NULL DEFAULT 0,
    CONSTRAINT fk_daily_stats_user FOREIGN KEY (user_id) REFERENCES user_account (id) ON DELETE CASCADE,
    CONSTRAINT uq_daily_stats_user_date UNIQUE (user_id, stat_date)
);

-- RevenueCat 상세 이력/감사용. 실제 프리미엄 판정(JWT의 isPremium, JwtAuthenticationFilter의
-- ROLE_PREMIUM)은 user_account.premium/premium_expires_at을 쓴다 — 이 테이블은 plan 이름 등
-- 부가 정보 보관용 미러일 뿐 인증 경로의 진실원천이 아니다.
CREATE TABLE subscription (
    user_id     BIGINT PRIMARY KEY,
    plan        VARCHAR(64) NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT FALSE,
    expires_at  DATETIME    NULL,
    updated_at  DATETIME    NOT NULL,
    CONSTRAINT fk_subscription_user FOREIGN KEY (user_id) REFERENCES user_account (id) ON DELETE CASCADE
);
