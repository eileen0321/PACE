// expo-sqlite 스키마. 서버(users/subscriptions)는 캐시로만 로컬에 두고, 세션 기록은
// SQLite를 1차 저장소로 쓴 뒤 services/api/client.ts의 statsApi로 동기화한다.
// PACE_ARCHITECTURE.md "DB 스키마" 섹션과 1:1 대응.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  renewal_date TEXT,
  updated_at TEXT NOT NULL
);

-- user_settings: 서버 동기화용 미러 테이블(향후 백엔드 연동 시 사용). 로컬 진실원천은 여전히
-- AsyncStorage(store/useSettingsStore.ts)다 — 단순 키-값 설정에 SQLite 왕복이 불필요해서 분리하고,
-- 이 테이블은 database/repositories/settingsRepository.ts가 update 시점마다 write-through로만 채운다.
-- app_shields_json: UserSettings.appShields(중첩 객체)는 컬럼화하지 않고 JSON 텍스트로
-- 저장 — 앱 목록이 늘어날 때마다 마이그레이션하지 않도록.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  auto_next INTEGER NOT NULL DEFAULT 1,
  sleep_timer_min INTEGER,
  daily_limit_min INTEGER NOT NULL DEFAULT 60,
  break_interval_min INTEGER NOT NULL DEFAULT 20,
  pre_session_breathing INTEGER NOT NULL DEFAULT 1,
  app_shields_json TEXT,
  theme TEXT NOT NULL DEFAULT 'system',
  language TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS viewing_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  videos_watched INTEGER NOT NULL DEFAULT 0,
  platform_app TEXT,
  -- 세션이 어떻게 끝났는지: completed(정상 종료) | daily_limit_reached | sleep_timer_expired | manual_stop
  -- 외부 리뷰 반영(2026-07-17): 통계 화면에서 "왜 끝났는지" 분석을 위해 추가.
  status TEXT,
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON viewing_sessions(started_at);

CREATE TABLE IF NOT EXISTS daily_stats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  total_minutes INTEGER NOT NULL DEFAULT 0,
  total_videos INTEGER NOT NULL DEFAULT 0,
  longest_session_seconds INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, date)
);

-- overlay_events: 네이티브 Auto Next/Overlay 모듈이 붙은 뒤 디버깅용 이벤트 로그.
-- 외부 리뷰 반영(2026-07-17) — AUTO_NEXT/SESSION_STOP/DAILY_LIMIT/BREAK_REMINDER 등을 시간순 기록해
-- "왜 자동 넘김이 안 됐는지" 같은 실기기 이슈를 사후에 재구성할 수 있게 미리 스키마만 준비해둔다.
CREATE TABLE IF NOT EXISTS overlay_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overlay_events_created_at ON overlay_events(created_at);

-- ── iOS Pace Feed (2026-07-18 iOS 전략 확정) ──
-- pace_videos: Pexels 등에서 받아온 피드의 로컬 캐시(오프라인/재방문 시 즉시 표시 + 통계 조인용).
-- 진실원천은 원격 API고, 이 테이블은 write-through 캐시 — database/repositories/playlistRepository.ts가 채운다.
CREATE TABLE IF NOT EXISTS pace_videos (
  id TEXT PRIMARY KEY,
  title TEXT,
  creator TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  category TEXT,
  source TEXT NOT NULL,
  cached_at TEXT NOT NULL
);

-- playlist_sessions: Pace Feed 자체 플레이어 안에서의 시청 세션(viewing_sessions=실제 숏폼 앱 세션과 구분).
-- Auto-Next로 몇 개를 봤는지/어떤 무드였는지 기록 → Insights에서 "건강한 대체 소비" 통계로 활용.
CREATE TABLE IF NOT EXISTS playlist_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  videos_watched INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_playlist_sessions_started_at ON playlist_sessions(started_at);

-- 2026-07-31 사장님 지시 — 오버레이 P 메뉴(Favorite/Capture/Shorts HOT)용. Favorite와 Capture는
-- 데이터 모양이 동일(둘 다 "영상 하나를 나중에 다시 보려고 저장")해서 kind 컬럼 하나로 같은 테이블을
-- 공유한다 — 의미만 다르다(Favorite=다시보기 목적, Capture=공유 목적, saved_videos.tsx 주석 참고).
-- thumbnail_url은 실제 스크린샷이 아니라 유튜브 공식 썸네일 URL(https://i.ytimg.com/vi/{videoId}/
-- hqdefault.jpg) — MediaProjection 권한 없이 video_id만으로 즉시 구성 가능(사장님 결정, 2026-07-31).
CREATE TABLE IF NOT EXISTS saved_videos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'favorite' | 'capture'
  video_id TEXT,
  title TEXT,
  channel TEXT,
  url TEXT,
  thumbnail_url TEXT,
  platform_app TEXT,
  added_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_videos_user_kind ON saved_videos(user_id, kind, added_at);
`;
