import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomSheetPadding, colors, radius, spacing, typography } from '../../constants/theme';

// healthy-shorts-assistant(2)의 Sleep Timer/Daily Limit/Auto Next 바텀시트 포팅. 셋 다 옵션 리스트
// 하나로 통일된 UI를 쓰길래(디자인 일관성) RN 쪽도 재사용 가능한 하나의 시트 컴포넌트로 뺐다 —
// 원본은 각 컨트롤마다 별도 마크업이었지만 로직이 100% 동일해 컴포넌트 하나로 합치는 게
// "죽은 코드 남기지 말라"는 지시와도 맞음(3벌 복붙 대신 1개 재사용).
export type QuickControlOption<T> = { label: string; value: T };

export function QuickControlSheet<T>({ visible, title, options, selectedValue, onSelect, onClose }: {
  visible: boolean;
  title: string;
  options: QuickControlOption<T>[];
  selectedValue: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>
        <View style={styles.options}>
          {options.map((opt) => {
            const selected = opt.value === selectedValue;
            return (
              <Pressable
                key={String(opt.value)}
                onPress={() => { onSelect(opt.value); onClose(); }}
                style={[styles.option, selected && styles.optionSelected]}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: spacing.lg, borderTopWidth: 1, borderColor: colors.border },
  handle: { width: 48, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', alignSelf: 'center', marginBottom: spacing.md },
  title: { fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary, marginBottom: spacing.md },
  options: { gap: spacing.xs },
  option: { padding: spacing.sm + 2, borderRadius: radius.button, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'transparent' },
  optionSelected: { backgroundColor: `${colors.primary}1A`, borderColor: `${colors.primary}4D` },
  optionText: { fontSize: 13, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary },
  optionTextSelected: { color: colors.primary, fontFamily: typography.bodyFontFamilyExtrabold },
});
