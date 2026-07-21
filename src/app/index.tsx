import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storage/keys';
import { colors } from '../constants/theme';

// Expo Router는 콜드 스타트 시 '/'(루트)로 진입한다 — (tabs) 그룹 안에 index.tsx가 없으면
// "Unmatched Route"가 뜬다(실기기 빌드로 발견). 2026-07-21: 온보딩 완료 여부 체크를 여기서 실제로
// 연결한다 — 이전엔 항상 홈으로 바로 보내 onboarding/index.tsx가 사실상 도달 불가능한 죽은
// 라우트였다(아래는 그 이전 주석 "후속 작업으로 남기고"의 후속).
//
// ⚠️ 2026-07-21 사용자 지시: "지금은 테스트 이미지니깨 매번 스플래시/가이드 뜨게" — 새 아이콘/
// 스플래시/온보딩 비주얼을 검토하는 동안은 완료 플래그를 무시하고 매번 온보딩을 띄운다.
// TEST_ALWAYS_SHOW_ONBOARDING을 false로 되돌리면 정상적인 "최초 1회만" 동작으로 복귀한다.
// 2026-07-21 밤: "맨 처음만 앱으로, 그 다음부턴 바로 YouTube" 런치 플로우를 실제로 테스트하려면
// 이 플래그가 켜져 있으면 안 됨(매번 온보딩만 반복돼 "다음번" 분기에 영영 도달 못함) — false로 복귀.
const TEST_ALWAYS_SHOW_ONBOARDING = false;

// 2026-07-21 밤 사용자 지시(PACE_ARCHITECTURE.md "런치 플로우 단순화" 참고) — 온보딩 이후
// 목적지를 탭 네비게이션(Home)이 아니라 곧바로 세션 화면(Android=Overlay+YouTube 자동실행,
// iOS=Pace Feed WebView)으로 바꾼다. 로그인/유료화 체크는 원래도 여기서 강제하지 않았으므로
// (게스트 폴백이 이미 자동 처리) "완전히 스킵" 요구사항은 추가 변경 없이 이미 충족돼 있다.
// 기존 탭(Home/Focus/Stats/Settings)은 완전히 유지 — overlay/index.tsx에 새로 추가한 앱 아이콘
// 버튼으로 언제든 들어갈 수 있다. iOS 쪽(/feed)은 맥 세션이 동시에 구현 중이라 여기서는 건드리지
// 않고 기존 Home 목적지를 그대로 둔다 — 완료되면 문서를 보고 이 파일의 iOS 분기만 맞춰 정리할 것.
export default function RootIndex() {
  const [target, setTarget] = useState<'home' | 'onboarding' | null>(null);

  useEffect(() => {
    if (TEST_ALWAYS_SHOW_ONBOARDING) {
      setTarget('onboarding');
      return;
    }
    AsyncStorage.getItem(STORAGE_KEYS.onboardingCompleted)
      .then((value) => setTarget(value === 'true' ? 'home' : 'onboarding'))
      .catch(() => setTarget('home')); // 읽기 실패해도 앱 자체는 계속 쓸 수 있어야 하므로 안전한 쪽(홈)으로 폴백
  }, []);

  if (target === null) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  if (target === 'onboarding') return <Redirect href="/onboarding" />;
  if (Platform.OS === 'android') return <Redirect href={{ pathname: '/overlay', params: { platform: 'youtube' } }} />;
  // iOS: 온보딩을 이미 겪은(=두 번째 실행부터) 콜드 스타트는 곧바로 세션 화면(Pace Feed WebView)으로.
  // (2026-07-21 "런치 플로우 단순화" — Android는 /overlay, iOS는 /feed. 맥 세션이 넣기로 한 iOS 분기.)
  // 탭(Home/Focus/Stats/Settings)은 유지 — /feed 우상단 "P" 앱 아이콘 버튼으로 언제든 복귀.
  return <Redirect href="/feed" />;
}
