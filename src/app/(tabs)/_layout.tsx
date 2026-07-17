import { Tabs } from 'expo-router';
import { colors } from '../../constants/theme';
import { useTranslation } from '../../services/i18n';

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
      }}
    >
      <Tabs.Screen name="home" options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="stats" options={{ title: t('tabs.stats') }} />
      <Tabs.Screen name="focus" options={{ title: t('tabs.focus') }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings') }} />
    </Tabs>
  );
}
