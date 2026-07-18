// Pace Feed 큐레이션 무드 정의 + Pexels 검색 쿼리 매핑.
// PACE_ARCHITECTURE.md "iOS 전략 확정 — Screen Time(차단) → Pace Feed(대체)" 참고.
// iOS는 실제 YouTube/Instagram을 차단(Screen Time)한 뒤, 그 대체 출구로 우리 자체 플레이어가
// 라이선스 콘텐츠를 Auto-Next로 재생한다. 여기 정의된 category → Pexels query로 피드를 당겨온다.
import type { PaceFeedCategory, PaceVideo } from '../types/models';

export type PaceFeedCategoryMeta = {
  key: PaceFeedCategory;
  label: string;
  /** Pexels 세로 영상 검색 쿼리. 웰니스/차분한 톤을 의도적으로 겨냥한다. */
  query: string;
};

export const PACE_FEED_CATEGORIES: PaceFeedCategoryMeta[] = [
  { key: 'calm', label: 'Calm', query: 'calm meditation slow motion' },
  { key: 'nature', label: 'Nature', query: 'nature forest scenery vertical' },
  { key: 'ocean', label: 'Ocean', query: 'ocean waves underwater calm' },
  { key: 'focus', label: 'Focus', query: 'minimal aesthetic focus ambient' },
];

export const DEFAULT_PACE_FEED_CATEGORY: PaceFeedCategory = 'calm';

// ⚠️ DEV 전용 폴백 — EXPO_PUBLIC_PEXELS_KEY 미설정 시 Pace Feed 플레이어/Auto-Next 흐름을 실기기 없이
// 눈으로 검증하기 위한 퍼블릭 도메인/CC 샘플 mp4. 프로덕션에서는 실제 Pexels 피드가 이 자리를 대체한다.
// (Google gtv-videos-bucket의 공개 샘플 스트림 — 데모/테스트 용도로 널리 쓰이는 클립들. 세로 영상이
//  아니라 데모 화면비만 맞지 않을 뿐 재생/자동넘김 로직 검증에는 충분.)
const GTV = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample';
export const DEV_SAMPLE_FEED: PaceVideo[] = [
  { id: 'sample_bunny', title: 'Big Buck Bunny', creator: 'Blender Foundation', durationSeconds: 60, url: `${GTV}/BigBuckBunny.mp4`, thumbnailUrl: `${GTV}/images/BigBuckBunny.jpg`, width: 1280, height: 720, category: 'calm', source: 'sample' },
  { id: 'sample_elephants', title: "Elephants Dream", creator: 'Orange Open Movie', durationSeconds: 60, url: `${GTV}/ElephantsDream.mp4`, thumbnailUrl: `${GTV}/images/ElephantsDream.jpg`, width: 1280, height: 720, category: 'calm', source: 'sample' },
  { id: 'sample_blazes', title: 'For Bigger Blazes', creator: 'Google', durationSeconds: 15, url: `${GTV}/ForBiggerBlazes.mp4`, thumbnailUrl: `${GTV}/images/ForBiggerBlazes.jpg`, width: 1280, height: 720, category: 'nature', source: 'sample' },
  { id: 'sample_escapes', title: 'For Bigger Escapes', creator: 'Google', durationSeconds: 15, url: `${GTV}/ForBiggerEscapes.mp4`, thumbnailUrl: `${GTV}/images/ForBiggerEscapes.jpg`, width: 1280, height: 720, category: 'ocean', source: 'sample' },
  { id: 'sample_fun', title: 'For Bigger Fun', creator: 'Google', durationSeconds: 60, url: `${GTV}/ForBiggerFun.mp4`, thumbnailUrl: `${GTV}/images/ForBiggerFun.jpg`, width: 1280, height: 720, category: 'focus', source: 'sample' },
];
