import { Platform, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { colors } from '../../constants/theme';
import { useTranslation } from '../../services/i18n';

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

  const renderIcon = (routeName: string) => ({ focused, color }: { focused: boolean; color: import('react-native').ColorValue; size: number }) => {
    return <Feather name={TAB_ICONS[routeName]} size={22} color={color as string} style={focused ? styles.iconActive : undefined} />;
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        // iOS: iOS 26 "Liquid Glass" 탭바 컨벤션 — 반투명 블러 위로 콘텐츠가 비쳐 보이는 떠 있는
        // 형태가 현재 시스템 기본값이라 네이티브 룩에 맞춰 따라간다(카드/오버레이는 기존 원칙대로
        // 플랫 유지 — 시스템 크롬에만 적용되는 예외). Android: Material 3는 블러 대신 불투명
        // elevation 서피스가 표준이고, zen-master/jlpt-master의 GlassSurface도 안드로이드에서 텍스트가
        // 같이 흐려지는 문제로 실제 블러를 쓰지 않고 flat 컬러로 대체했던 전례를 그대로 따른다.
        tabBarStyle: Platform.select({
          ios: { position: 'absolute', borderTopWidth: 0, elevation: 0 },
          android: { backgroundColor: colors.card, borderTopColor: colors.border, elevation: 8 },
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
  );
}

const styles = StyleSheet.create({
  iconActive: { }, // Feather는 strokeWidth prop이 없어(고정 아웃라인) 색상 변화만으로 활성 표시 — size/color 이미 충분한 대비
});
