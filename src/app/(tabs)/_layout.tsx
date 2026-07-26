import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography } from '../../constants/theme';
import { useTranslation } from '../../services/i18n';
import { AdBanner } from '../../components/home/AdBanner';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { useAdBannerStore } from '../../store/useAdBannerStore';

// 2026-07-19 실기기(갤럭시 Note20, 3버튼 내비게이션) 1차 수정 — jlpt-master/zen-master의 방어적
// 최솟값 패턴(paddingBottom = Math.max(insets.bottom, 10))을 그대로 이식했으나, 실기기 스크린샷을
// 픽셀 단위로 재확인한 결과 여전히 탭 라벨과 시스템 내비게이션 아이콘 사이 여백이 거의 0이었다.
// 원인 파악: 이 기기는 insets.bottom을 이미 "정확하게"(내비게이션 바 실제 높이만큼) 보고하고
// 있어서 Math.max(...) 최솟값 자체가 발동하지 않았다 — 최솟값 패턴은 "insets.bottom이 부정확하게
// 작게 보고되는" 기기를 방어하는 것이지, "insets.bottom이 정확해도 탭바 내용물과 내비게이션 바
// 사이에 숨 쉴 공간이 없는" 문제는 애초에 못 막는다. paddingBottom을 insets.bottom과 똑같이 주면
// 탭바 콘텐츠가 내비게이션 바 바로 위 경계에 딱 붙어(기능적으로는 안 가려지지만) 시각적으로는
// "겹쳐 보인다". 그래서 최솟값 위에 순수 여유값(EXTRA_GAP)을 항상 더한다 — insets.bottom이 얼마든
// 상관없이 추가 여백은 항상 보장된다.
const TAB_BAR_BASE_HEIGHT = 49; // expo-router 내장 BottomTabBar의 TABBAR_HEIGHT_UIKIT과 동일
const ANDROID_MIN_BOTTOM_INSET = 10; // insets.bottom이 비정상적으로 작게 보고되는 기기에 대한 방어
const ANDROID_EXTRA_BOTTOM_GAP = 12; // insets.bottom이 정확해도 탭바-내비게이션 바 사이에 항상 둘 순수 시각적 여백

// healthy-shorts-assistant(2) App.tsx 하단 내비게이션 아이콘을 토씨 하나 안 틀리고 그대로 이식
// (App.tsx:539/550/561/572, lucide-react Home/Sliders/BarChart2/Settings) — outline↔filled
// 스왑이 아니라 "같은 글리프 + 활성 시 색상(인디고)·굵기(stroke-[2.5]) 변화"만 준다.
// lucide의 Home/Sliders/BarChart2/Settings ≈ Feather의 home/sliders/bar-chart-2/settings로
// 1:1 매칭(이미 앱 전역에 링크된 @expo/vector-icons 재사용, 별도 아이콘 폰트 불필요).
// 이전 버전은 Ionicons로 outline/filled를 바꿔치기했는데, 원본엔 그런 필드 스왑이 없었다.
const TAB_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  home: 'home',
  focus: 'sliders',
  stats: 'bar-chart-2',
  settings: 'settings',
};

export default function TabsLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const androidBottomInset = Math.max(insets.bottom, ANDROID_MIN_BOTTOM_INSET) + ANDROID_EXTRA_BOTTOM_GAP;
  // 2026-07-25 사용자 지적 — 배너가 화면(Home/Focus/Stats/Settings) 각각에 따로 있으면 탭을
  // 넘나들 때마다 그 화면의 배너 인스턴스가 새로 마운트되면서 매번 새 광고를 구글 서버에서 다시
  // 받아와야 해서 "탭 넘길 때마다 잠깐 비었다가 뜨는" 게 반복됐다. Tabs 내비게이터 자체와 같은
  // 레벨(형제)에 딱 하나만 두고 탭바 바로 위에 절대 위치로 고정하면, 화면이 바뀌어도 이 배너는
  // 리마운트되지 않아 광고를 한 번만 불러온다 — 화면들(각 tabs/*.tsx)에 있던 개별 <AdBanner />는
  // 제거했다(중복 표시 방지).
  const tabBarHeight = TAB_BAR_BASE_HEIGHT + (Platform.OS === 'android' ? androidBottomInset : insets.bottom);
  // 2026-07-26 사용자 지적 — 화면들(Home/Focus/Stats/Settings)이 이 실제 탭바 높이 대신 어긋난
  // 고정 상수(layout.tabBarContentClearance)를 참조해 광고 배너+탭바 뒤에 콘텐츠가 가려졌다.
  // 이 유일한 계산값을 공유 store에 반영해 화면들이 항상 실제 값을 읽게 한다.
  const setTabBarHeight = useAdBannerStore((s) => s.setTabBarHeight);
  useEffect(() => {
    setTabBarHeight(tabBarHeight);
  }, [tabBarHeight, setTabBarHeight]);

  const renderIcon = (routeName: string) => ({ focused, color }: { focused: boolean; color: import('react-native').ColorValue; size: number }) => {
    return <Feather name={TAB_ICONS[routeName]} size={22} color={color as string} style={focused ? styles.iconActive : undefined} />;
  };

  return (
    <View style={styles.root}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: '#8E8E93',
        // App.tsx:540 "text-[10px] font-black tracking-widest uppercase mt-1.5" — 라벨을 명시
        // 지정 안 하면 RN 기본 탭 라벨(더 크고 굵기가 다른 시스템 폰트)이 적용돼 원본보다 커
        // 보였다.
        tabBarLabelStyle: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 6 },
        tabBarItemStyle: { paddingVertical: 4 },
        // iOS: iOS 26 "Liquid Glass" 탭바 컨벤션 — 반투명 블러 위로 콘텐츠가 비쳐 보이는 떠 있는
        // 형태가 현재 시스템 기본값이라 네이티브 룩에 맞춰 따라간다(카드/오버레이는 기존 원칙대로
        // 플랫 유지 — 시스템 크롬에만 적용되는 예외). Android: Material 3는 블러 대신 불투명
        // elevation 서피스가 표준이고, zen-master/jlpt-master의 GlassSurface도 안드로이드에서 텍스트가
        // 같이 흐려지는 문제로 실제 블러를 쓰지 않고 flat 컬러로 대체했던 전례를 그대로 따른다.
        tabBarStyle: Platform.select({
          ios: { position: 'absolute', borderTopWidth: 0, elevation: 0 },
          android: {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            elevation: 8,
            height: TAB_BAR_BASE_HEIGHT + androidBottomInset,
            paddingBottom: androidBottomInset,
          },
        }),
        // 2026-07-18: 앱 전체가 항상-다크 테마로 리스킨되면서(시스템 라이트/다크 모드를 따라가는 게
        // 아니라 앱 자체가 다크 고정) 블러 틴트도 Dark로 고정.
        tabBarBackground: Platform.OS === 'ios'
          ? () => <BlurView tint="systemChromeMaterialDark" intensity={90} style={StyleSheet.absoluteFill} />
          : undefined,
      }}
    >
      <Tabs.Screen name="home" options={{ title: t('tabs.home'), tabBarIcon: renderIcon('home') }} />
      <Tabs.Screen name="focus" options={{ title: t('tabs.focus'), tabBarIcon: renderIcon('focus') }} />
      <Tabs.Screen name="stats" options={{ title: t('tabs.stats'), tabBarIcon: renderIcon('stats') }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings'), tabBarIcon: renderIcon('settings') }} />
    </Tabs>
    {!isPremium && (
      <View style={[styles.adBannerFloat, { bottom: tabBarHeight }]} pointerEvents="box-none">
        <AdBanner />
      </View>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Tabs 내비게이터와 형제로 두고 탭바 바로 위에 절대 위치로 고정 — 화면(Home/Focus/Stats/
  // Settings)이 바뀌어도 이 배너는 리마운트되지 않으므로 탭 전환마다 광고를 새로 안 받아온다.
  adBannerFloat: { position: 'absolute', left: 0, right: 0 },
  iconActive: { }, // Feather는 strokeWidth prop이 없어(고정 아웃라인) 색상 변화만으로 활성 표시 — size/color 이미 충분한 대비
});
