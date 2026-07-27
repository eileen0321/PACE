// Auto Next 엔진(Android)이 감시하는 숏폼 앱 화이트리스트.
// 패키지명은 Android용, iOS는 Auto Next 자체를 지원하지 않으므로 참고용(Usage Tracking에만 사용).
export type ShortFormApp = 'youtube' | 'instagram' | 'tiktok' | 'facebook' | 'naver_clip';

export const SHORT_FORM_APPS: Record<ShortFormApp, { label: string; androidPackage: string; iosBundleId: string }> = {
  youtube: { label: 'Shorts', androidPackage: 'com.google.android.youtube', iosBundleId: 'com.google.ios.youtube' },
  instagram: { label: 'Instagram Reels', androidPackage: 'com.instagram.android', iosBundleId: 'com.burbn.instagram' },
  tiktok: { label: 'TikTok', androidPackage: 'com.zhiliaoapp.musically', iosBundleId: 'com.zhiliaoapp.musically' },
  facebook: { label: 'Facebook Reels', androidPackage: 'com.facebook.katana', iosBundleId: 'com.facebook.Facebook' },
  naver_clip: { label: 'Naver Clip', androidPackage: 'com.nhn.android.search', iosBundleId: 'com.nhn.searchapp' },
};
