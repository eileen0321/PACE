import { useEffect, useState } from 'react';
import { View } from 'react-native';
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

// 2026-07-21 밤 사용자 지시로 한때 콜드 스타트 목적지를 탭 네비게이션(Home)이 아니라 곧바로
// 세션 화면(Android=Overlay+YouTube 자동실행)으로 바꿨었으나, 2026-07-24 사용자 지적으로 되돌림 —
// iOS는 바로 다음날(2026-07-22) "심사자가 유튜브가 아니라 네이티브 홈을 먼저 보게" App Review
// 리스크 때문에 콜드 스타트를 홈으로 되돌렸는데, 그 수정이 Android엔 반영이 안 된 채(당시 주석에
// "Android는 기존 유지"로 명시) 그대로 남아 있었다. 결과적으로 Android는 앱을 켜자마자 화면이 곧장
// 유튜브로 덮여, (a) 같은 4.2/5.2.2류 심사 리스크에 그대로 노출되고 (b) 프리미엄 스플래시 애니메이션과
// 홈의 쉬는시간(Flip Mode)/수면 인사이트 카드가 스칠 새도 없이 가려졌다. 이제 두 플랫폼 모두 콜드
// 스타트는 홈으로 — 세션은 기존처럼 사용자가 플랫폼 카드를 직접 탭해야 시작된다.
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
  return <Redirect href="/(tabs)/home" />;
}
