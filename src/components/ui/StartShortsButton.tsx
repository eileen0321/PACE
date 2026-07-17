import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../constants/theme';

// healthy-shorts-assistant의 StartShortsButton.tsx 포팅.
export function StartShortsButton({ onPress, isLimitReached }: { onPress: () => void; isLimitReached: boolean }) {
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        disabled={isLimitReached}
        style={[styles.button, isLimitReached ? styles.buttonDisabled : styles.buttonActive]}
      >
        <Feather name="play" size={18} color={isLimitReached ? colors.textSecondary : '#FFFFFF'} />
        <Text style={[styles.buttonText, isLimitReached && { color: colors.textSecondary }]}>Start Shorts</Text>
        <Feather name="zap" size={16} color={isLimitReached ? colors.textSecondary : 'rgba(255,255,255,0.8)'} />
      </Pressable>
      <Text style={styles.hint}>
        {isLimitReached ? 'You have reached your daily healthy viewing limit.' : 'Tap to begin your Pace-managed session'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  button: { paddingVertical: spacing.md + 4, borderRadius: radius.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  buttonActive: { backgroundColor: '#1C1C1E' },
  buttonDisabled: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  hint: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' },
});
