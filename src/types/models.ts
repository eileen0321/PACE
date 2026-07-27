export type AuthProvider = 'apple' | 'google' | 'guest';

export type User = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  provider: AuthProvider;
  isGuest: boolean;
  createdAt: string;
};

export type SubscriptionPlan = 'free' | 'premium_monthly' | 'premium_yearly';
export type SubscriptionStatus = 'active' | 'expired' | 'none';

export type Subscription = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  expiresAt: string | null;
};

export type AppShieldTarget = 'youtube' | 'instagram' | 'tiktok';

export type UserSettings = {
  autoNext: boolean;
  sleepTimerMinutes: number | null;
  dailyLimitMinutes: number;
  breakIntervalMinutes: number;
  /** 세션 시작 전 15초 호흡 유도 화면 — 오버레이 자체와는 별개로, 세션 진입 전 1회성 프리롤. */
  preSessionBreathing: boolean;
  appShields: Record<AppShieldTarget, boolean>;
  theme: 'light' | 'dark' | 'system';
  /** 'system'이면 기기 로케일을 따름(en/ko만 지원, 그 외 언어는 en으로 폴백). */
  language: 'system' | 'en' | 'ko';
  /** 2026-07-18: Settings 탭 Notifications 섹션의 토글 3개 — 이전엔 컴포넌트 로컬 useState라
   *  화면을 벗어나면 항상 기본값(true)으로 리셋되고 실제 알림 발송 여부에 전혀 반영되지 않았다. */
  notifyRemaining: boolean;
  notifyLimit: boolean;
  notifyBreak: boolean;
  /**
   * 2026-07-19: 한도/Sleep Timer 만료 시 전체화면 Overlay 차단(항상 켜짐, 옵트아웃 불가)에 더해
   * YouTube 자체를 강제로 홈 화면으로 내보낼지(Android GLOBAL_ACTION_HOME). 기본 false — 사용자가
   * Settings에서 명시적으로 켜야만 동작(제품 결정: 침해감이 큰 동작이라 기본값 ON은 안 함).
   */
  hardBlockMode: boolean;
  /**
   * 2026-07-27 사용자 지시 — 블루투스 스피커/이어폰(에어팟 등)을 순수 음향 감상용으로만 쓰는
   * 사람도 있으므로, 볼륨키를 다음/이전 영상 넘기기 신호로 쓸지 여부를 별도로 끌 수 있어야 한다
   * (기존 손짓/핑거스냅 Hands-Free 토글과는 독립적 — 카메라 제스처는 켜두고 블루투스 볼륨키
   * 하이재킹만 끄고 싶은 경우가 있을 수 있음). 기본 true(기존 동작 유지).
   */
  bluetoothVolumeKeySkipEnabled: boolean;
  /**
   * 2026-07-21 밤 감사 발견 — Android는 이 값을 설정 가능(bluetoothService의 네이티브 미러 경유)했지만
   * iOS(feed/index.tsx)는 10분 하드코딩이었고 설정 UI 자체가 없었다. 공용 JS 소스오브트루스로 승격 —
   * Android는 여기서 update() 후 별도로 bluetoothService.setFocusSessionDurationMinutes()를 호출해
   * 네이티브 SharedPreferences 미러도 함께 갱신한다(Kotlin의 자동 종료 타이머가 그 값을 직접 읽으므로).
   */
  focusSessionDurationMinutes: number;
  /**
   * 2026-07-26 사장님 결정(D8, "고급 취침모드") — 무진동 수면감지 임계값(분). 무료는 항상 10분
   * 고정(기존 동작 그대로), 프리미엄만 5~20분 사이 직접 조절 가능 — 페이월이 광고하는 "Advanced
   * Sleep Mode(customizable stillness sensitivity)"의 실제 구현. Android
   * PaceOverlayService(SLEEP_STILLNESS_MS 대체)만 실제로 쓰고, iOS는 수면감지 자체가 아직 없어
   * 이 값을 읽는 곳이 없음(무해).
   */
  sleepStillnessMinutes: number;
  /**
   * 2026-07-27 사장님 지시 — "블루투스 볼륨키로 영상 넘기기" 명시적 토글. iOS는 볼륨키 출처(폰 vs BT 리모컨)를
   * 구분할 수 없어(안드 KeyEvent.getDevice() 대응 API 없음) "리모컨만 스킵"이 불가능하므로, 사용자가 리모컨을
   * 쓸 때 직접 켜는 스위치로 처리한다. ON이면 피드에서 볼륨키(싸구려 카메라 리모컨)·미디어 전송버튼(에어팟 등)
   * 둘 다 Short 넘김으로 쓰고(하이브리드), OFF면 볼륨키는 정상 음량 조절. 기본 OFF.
   */
  volumeKeyRemote: boolean;
};

// 'sleep_detected' — 수면 감지 강제 종료(스펙 §1-B/§4-B, 2026-07-23, Android 네이티브 PaceOverlayService
// 무진동 감지). 'sleep_timer_expired'(사용자가 직접 설정한 카운트다운)와는 다른 별개 사유.
// 'app_restarted' — 2026-07-26 감사 발견(재부팅/강제종료/크래시 예외처리 감사) 대응: 프로세스가
// 중간에 죽어(overlay/index.tsx의 unmount cleanup이 못 돌아서) ended_at이 영원히 NULL로 남는 "고아"
// 세션을 다음 콜드스타트 때 정리할 때 쓰는 사유 — 실제 종료 원인을 알 수 없을 때의 폴백.
export type SessionEndStatus = 'completed' | 'daily_limit_reached' | 'sleep_timer_expired' | 'sleep_detected' | 'manual_stop' | 'app_restarted';

export type ViewingSession = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  videosWatched: number;
  platformApp: string | null;
  status: SessionEndStatus | null;
};

export type OverlayEventType = 'AUTO_NEXT' | 'SESSION_STOP' | 'DAILY_LIMIT' | 'BREAK_REMINDER' | 'SLEEP_TIMER';

export type OverlayEvent = {
  id: string;
  sessionId: string | null;
  eventType: OverlayEventType;
  detail: string | null;
  createdAt: string;
};

export type DailyStats = {
  date: string; // YYYY-MM-DD
  totalMinutes: number;
  totalVideos: number;
  longestSessionSeconds: number;
};

// ── iOS Pace Feed (2026-07-18 iOS 전략 확정 — PACE_ARCHITECTURE.md "iOS 전략 확정" 참고) ──
// iOS는 다른 앱을 오버레이/자동넘김할 수 없으므로(OS 제약), Screen Time으로 실제 숏폼을 차단하고
// 그 대체 출구로 우리 자체 플레이어(expo-video)가 라이선스 콘텐츠(Pexels 등)를 Auto-Next로 재생한다.
// 우리가 권리를 가진 콘텐츠라 재생·자동넘김·UI가 100% 합법·자유 — YouTube WebView 래핑(원안 ①)의
// 약관/심사 리스크가 없다.
export type PaceFeedSource = 'pexels' | 'sample';

/** Pace Feed의 큐레이션 무드 — Pexels 검색 쿼리로 매핑된다(constants/paceFeed.ts). */
export type PaceFeedCategory = 'calm' | 'nature' | 'ocean' | 'focus';

export type PaceVideo = {
  id: string; // 'pexels_12345' | 'sample_xxx'
  title: string;
  creator: string;
  durationSeconds: number;
  /** 직접 재생 가능한 mp4 URL(세로 우선). expo-video의 source로 그대로 사용. */
  url: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  category: PaceFeedCategory;
  source: PaceFeedSource;
};

/** Pace Feed 시청 세션 — viewing_sessions(실제 숏폼 앱 세션)와 구분되는, 우리 플레이어 안에서의 세션. */
export type PlaylistSession = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  videosWatched: number;
  category: PaceFeedCategory | null;
};

// ── iOS Pace Feed = YouTube Shorts 순차 재생 (2026-07-18 사용자 지시, PACE_ARCHITECTURE.md
// "iOS Pace Feed 재정의" 참고) ──
// 재생은 공식 YouTube IFrame Player API(합법)로 하고, 리스트(영상 ID)만 Data API/스크래핑으로 받는다.
// 스트림을 긁지 않는다 — videoId만 있으면 IFrame이 YouTube 서버에서 직접 스트리밍.
export type YouTubeShort = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string | null;
};
