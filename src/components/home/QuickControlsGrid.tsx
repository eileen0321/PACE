import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useSettingsStore } from '../../store/useSettingsStore';
import { QuickControlSheet } from './QuickControlSheet';

const SLEEP_TIMER_OPTIONS = [0, 15, 30, 45, 60];
const DAILY_LIMIT_OPTIONS = [15, 30, 45, 60, 90, 120];

type SheetKind = 'sleepTimer' | 'dailyLimit' | 'autoNext' | null;

// healthy-shorts-assistant(2) App.tsx "Quick Controls" 3단 그리드 포팅(App.tsx:401-456). focus.tsx
// 에도 같은 설정을 순환-탭(cycle) 방식으로 편집하는 UI가 이미 있는데, 여기서는 원본 디자인대로
// 바텀시트 선택 방식을 쓴다 — 값 소스는 동일한 useSettingsStore라 두 화면 중 어디서 바꾸든 항상
// 일치한다(중복 상태 없음). App.tsx Home 탭은 translations를 안 쓰므로(주석 참고, home.tsx) 라벨/
// OFF/ON 전부 원본처럼 하드코딩 영어 고정 — 번역하면 타일 폭을 넘친다.
export function QuickControlsGrid() {
  const { settings, update } = useSettingsStore();
  const [openSheet, setOpenSheet] = useState<SheetKind>(null);

  const sleepLabel = settings.sleepTimerMinutes ? `${settings.sleepTimerMinutes}m` : 'OFF';
  const limitLabel = `${settings.dailyLimitMinutes}m`;
  const autoNextLabel = settings.autoNext ? 'ON' : 'OFF';

  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        <Tile icon="moon" label="Sleep Timer" value={sleepLabel} onPress={() => setOpenSheet('sleepTimer')} />
        <Tile icon="clock" label="Daily Limit" value={limitLabel} onPress={() => setOpenSheet('dailyLimit')} />
        <Tile icon="zap" label="Auto Next" value={autoNextLabel} onPress={() => setOpenSheet('autoNext')} />
      </View>

      <QuickControlSheet
        visible={openSheet === 'sleepTimer'}
        title="Sleep Timer"
        options={SLEEP_TIMER_OPTIONS.map((m) => ({ label: m === 0 ? 'OFF' : `${m}m`, value: m }))}
        selectedValue={settings.sleepTimerMinutes ?? 0}
        onSelect={(v) => update({ sleepTimerMinutes: v === 0 ? null : v })}
        onClose={() => setOpenSheet(null)}
      />
      <QuickControlSheet
        visible={openSheet === 'dailyLimit'}
        title="Daily Limit"
        options={DAILY_LIMIT_OPTIONS.map((m) => ({ label: `${m}m`, value: m }))}
        selectedValue={settings.dailyLimitMinutes}
        onSelect={(v) => update({ dailyLimitMinutes: v })}
        onClose={() => setOpenSheet(null)}
      />
      <QuickControlSheet
        visible={openSheet === 'autoNext'}
        title="Auto Next"
        options={[{ label: 'ON', value: true }, { label: 'OFF', value: false }]}
        selectedValue={settings.autoNext}
        onSelect={(v) => update({ autoNext: v })}
        onClose={() => setOpenSheet(null)}
      />
    </View>
  );
}

function Tile({ icon, label, value, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}>
      <Feather name={icon} size={16} color={colors.primary} />
      <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={1}>{value}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 24, marginTop: spacing.sm },
  grid: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.chip + 4, padding: 12, gap: 4 },
  tilePressed: { opacity: 0.8 },
  tileLabel: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  tileValue: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
});
