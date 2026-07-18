import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useSettingsStore } from '../../store/useSettingsStore';
import { QuickControlSheet } from './QuickControlSheet';

const SLEEP_TIMER_OPTIONS = [0, 15, 30, 45, 60];
const DAILY_LIMIT_OPTIONS = [15, 30, 45, 60, 90, 120];
const BREAK_OPTIONS = [0, 10, 15, 20, 30];

type SheetKind = 'sleepTimer' | 'dailyLimit' | 'breakReminder' | null;

// healthy-shorts-assistant(2) App.tsx "Quick Controls" 3단 그리드 포팅(App.tsx:401-456). focus.tsx
// 에도 같은 설정을 순환-탭(cycle) 방식으로 편집하는 UI가 이미 있는데, 여기서는 원본 디자인대로
// 바텀시트 선택 방식을 쓴다 — 값 소스는 동일한 useSettingsStore라 두 화면 중 어디서 바꾸든 항상
// 일치한다(중복 상태 없음). App.tsx Home 탭은 translations를 안 쓰므로(주석 참고, home.tsx) 라벨/
// OFF/ON 전부 원본처럼 하드코딩 영어 고정 — 번역하면 타일 폭을 넘친다.
// 2026-07-18: 원본 3번째 타일은 "Auto Next"였는데, 사용자 지시(외부 프로덕트 조언 반영)로 Home
// 전면에서 AUTO 브랜딩을 빼기로 해서 Break Reminder로 교체 — Auto Next 토글 자체는 기능적으로
// 사라진 게 아니라 Focus 탭의 Session Status/Interventions에서 여전히 켜고 끌 수 있다.
export function QuickControlsGrid() {
  const { settings, update } = useSettingsStore();
  const [openSheet, setOpenSheet] = useState<SheetKind>(null);

  const sleepLabel = settings.sleepTimerMinutes ? `${settings.sleepTimerMinutes}m` : 'OFF';
  const limitLabel = `${settings.dailyLimitMinutes}m`;
  const breakLabel = settings.breakIntervalMinutes ? `${settings.breakIntervalMinutes}m` : 'OFF';

  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        <Tile icon="moon" label="Sleep Timer" value={sleepLabel} onPress={() => setOpenSheet('sleepTimer')} />
        <Tile icon="clock" label="Daily Limit" value={limitLabel} onPress={() => setOpenSheet('dailyLimit')} />
        <Tile icon="coffee" label="Break Reminder" value={breakLabel} onPress={() => setOpenSheet('breakReminder')} />
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
        visible={openSheet === 'breakReminder'}
        title="Break Reminder"
        options={BREAK_OPTIONS.map((m) => ({ label: m === 0 ? 'OFF' : `${m}m`, value: m }))}
        selectedValue={settings.breakIntervalMinutes}
        onSelect={(v) => update({ breakIntervalMinutes: v })}
        onClose={() => setOpenSheet(null)}
      />
    </View>
  );
}

// 원본 App.tsx:411 "text-center flex flex-col justify-between" + 아이콘 줄 "flex justify-center
// mb-1" — 아이콘/라벨/값 전부 가운데 정렬인데 이전 버전은 alignItems/textAlign을 아예 안 줘서
// 왼쪽 정렬로 잘못 나오고 있었다. 아이콘 크기도 w-4.5 h-4.5(18px)인데 16으로 살짝 작았음.
function Tile({ icon, label, value, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}>
      <View style={styles.iconRow}>
        <Feather name={icon} size={18} color={colors.primary} />
      </View>
      <View>
        <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.tileValue} numberOfLines={1}>{value}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 24, marginTop: spacing.sm },
  grid: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.chip + 4, padding: 14, alignItems: 'center', justifyContent: 'space-between' },
  tilePressed: { opacity: 0.8 },
  iconRow: { marginBottom: 4 },
  tileLabel: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center' },
  tileValue: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary, textAlign: 'center', marginTop: 4 },
});
