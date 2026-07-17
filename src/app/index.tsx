import { Redirect } from 'expo-router';

// Expo Router는 콜드 스타트 시 '/'(루트)로 진입한다 — (tabs) 그룹 안에 index.tsx가 없으면
// "Unmatched Route"가 뜬다(실기기 빌드로 발견). 온보딩 완료 여부 체크는 후속 작업으로 남기고
// 우선 홈 탭으로 리다이렉트.
export default function RootIndex() {
  return <Redirect href="/(tabs)/home" />;
}
