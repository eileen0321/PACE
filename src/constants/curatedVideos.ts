// healthy-shorts-assistant의 data.ts(CURATED_VIDEOS) 포팅 — 실기기에서 Android 오버레이/iOS Live
// Activity 네이티브 모듈이 붙기 전까지, /overlay 세션 화면에서 "실제 YouTube 등이 아래 깔려있다"를
// 흉내 내는 개발용 시뮬레이터 콘텐츠로만 사용한다. 프로덕션에서는 실제 숏폼 앱이 이 자리를 대체한다.
export type CuratedVideo = {
  id: string;
  title: string;
  category: 'Mindfulness' | 'Wellness' | 'Focus' | 'Wisdom' | 'Habits';
  creator: string;
  durationSeconds: number;
  description: string;
};

export const CURATED_VIDEOS: CuratedVideo[] = [
  { id: 'v1', title: '1-Minute Box Breathing', category: 'Mindfulness', creator: '@mindful_flow', durationSeconds: 60, description: 'Inhale, hold, exhale. Reset your nervous system in just 60 seconds with this classic box breathing ritual.' },
  { id: 'v2', title: 'Quick Neck & Shoulder Stretch', category: 'Wellness', creator: '@body_alignment', durationSeconds: 40, description: 'Release computer fatigue. Roll your shoulders back, tuck your chin, and gently stretch your upper trapezius.' },
  { id: 'v3', title: 'The 2-Minute Habit Rule', category: 'Focus', creator: '@productive_mind', durationSeconds: 45, description: 'If an action takes less than two minutes, do it now. Overcome procrastination and build unstoppable momentum.' },
  { id: 'v4', title: 'Instant Eye Strain Relief', category: 'Wellness', creator: '@healthy_eyes', durationSeconds: 30, description: 'Practice the 20-20-20 rule: Look at something 20 feet away for 20 seconds to rest your ciliary muscles.' },
  { id: 'v5', title: 'The Power of Micro-Pauses', category: 'Habits', creator: '@wisdom_bites', durationSeconds: 50, description: 'Taking a 60-second micro-pause between tasks reduces cortisol buildup. Breathe in slowly.' },
  { id: 'v6', title: 'Gratitude Impulse', category: 'Mindfulness', creator: '@joy_academy', durationSeconds: 30, description: 'Name three things you are genuinely grateful for right now. Reframe your day and boost dopamine levels.' },
];
