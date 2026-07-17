import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettingsStore } from '../../store/useSettingsStore';
import { capabilities } from '../../services/platform';
import { SectionCard, ShieldRow, ToggleRow, ValueRow } from '../../components/ui/SettingsRow';
import { colors, radius, spacing } from '../../constants/theme';
import type { AppShieldTarget } from '../../types/models';

const SLEEP_TIMER_OPTIONS = [0, 15, 30, 45, 60];
const DAILY_LIMIT_OPTIONS = [15, 30, 45, 60, 90, 120];
const BREAK_REMINDER_OPTIONS = [0, 10, 15, 20, 30];

function cycle(options: number[], current: number): number {
  const idx = options.indexOf(current);
  return options[(idx + 1) % options.length];
}

const SHIELD_LABELS: Record<AppShieldTarget, { title: string; description: string }> = {
  youtube: { title: 'YouTube Shorts Block', description: 'Shield active on default browser' },
  instagram: { title: 'Instagram Reels Block', description: 'Blocks Reels feed auto-scroll' },
  tiktok: { title: 'TikTok Block', description: 'Restricts continuous feed loop' },
};

// healthy-shorts-assistant의 SettingsSection.tsx(Focus 탭) 포팅: Active Interventions / Friction &
// Micro-Breaks / System Sync Shields 3섹션. iOS는 Auto Next capability가 없어 그 행만 숨긴다
// (PACE_ARCHITECTURE.md "컨벤션 규칙" — capability 플래그로 상위 UI가 자연 분기).
// 3단 순환: 상속(null, 전역값 따름) → ON → OFF → 상속
function cycleOverride(current: boolean | null): boolean | null {
  if (current === null) return true;
  if (current === true) return false;
  return null;
}

function overrideLabel(current: boolean | null): string {
  return current === null ? 'Default' : current ? 'ON' : 'OFF';
}

export default function FocusScreen() {
  const { settings, update, updateAppOverride } = useSettingsStore();

  const toggleShield = (target: AppShieldTarget) => {
    update({ appShields: { ...settings.appShields, [target]: !settings.appShields[target] } });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>집중 모드</Text>

        <Section title="Active Interventions" badge="Shield Core">
          <SectionCard>
            {capabilities.supportsAutoNext && (
              <ToggleRow
                title="Auto Next"
                description="Automatically play subsequent videos"
                value={settings.autoNext}
                onToggle={() => update({ autoNext: !settings.autoNext })}
              />
            )}
            <ValueRow
              title="Sleep Timer"
              description="Playback auto-lock delay"
              value={settings.sleepTimerMinutes ? `${settings.sleepTimerMinutes} min` : 'OFF'}
              onPress={() => update({ sleepTimerMinutes: cycle(SLEEP_TIMER_OPTIONS, settings.sleepTimerMinutes ?? 0) || null })}
            />
            <ValueRow
              title="Daily Limit"
              description="Mindful ceiling restriction"
              value={`${settings.dailyLimitMinutes} min`}
              onPress={() => update({ dailyLimitMinutes: cycle(DAILY_LIMIT_OPTIONS, settings.dailyLimitMinutes) })}
            />
          </SectionCard>
        </Section>

        <Section title="Friction & Micro-Breaks">
          <SectionCard>
            <ValueRow
              title="Break Reminder"
              description="Forced stretch/rest notification cycle"
              value={settings.breakIntervalMinutes ? `${settings.breakIntervalMinutes} min` : 'OFF'}
              onPress={() => update({ breakIntervalMinutes: cycle(BREAK_REMINDER_OPTIONS, settings.breakIntervalMinutes) })}
            />
            <ToggleRow
              title="Pre-session Breathing"
              description="15s respiration trigger before starting"
              value={settings.preSessionBreathing}
              onToggle={() => update({ preSessionBreathing: !settings.preSessionBreathing })}
            />
          </SectionCard>
        </Section>

        <Section title="System Sync Shields">
          <SectionCard>
            {(Object.keys(SHIELD_LABELS) as AppShieldTarget[]).map((key) => (
              <ShieldRow
                key={key}
                title={SHIELD_LABELS[key].title}
                description={SHIELD_LABELS[key].description}
                active={settings.appShields[key]}
                onToggle={() => toggleShield(key)}
              />
            ))}
          </SectionCard>
        </Section>

        {capabilities.supportsAutoNext && (
          <Section title="Per-App Auto Next">
            <SectionCard>
              {(Object.keys(SHIELD_LABELS) as AppShieldTarget[]).map((key) => (
                <ValueRow
                  key={key}
                  title={SHIELD_LABELS[key].title.replace(' Block', '')}
                  description="Default = follow Active Interventions setting above"
                  value={overrideLabel(settings.perApp[key].autoNext)}
                  onPress={() => updateAppOverride(key, { autoNext: cycleOverride(settings.perApp[key].autoNext) })}
                />
              ))}
            </SectionCard>
          </Section>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: 32 },
  screenTitle: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.xs },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xs },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1 },
  badge: { backgroundColor: colors.primaryTint, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '700', color: colors.primary },
});
