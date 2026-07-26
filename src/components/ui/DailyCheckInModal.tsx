import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../services/i18n';
import { colors, radius, spacing, typography } from '../../constants/theme';

// 2026-07-26 사용자 지시("매일 출석하기 ... 크레딧 적립되었다는 알림 팝업") — _layout.tsx가 부팅
// 시 useAttendanceStore.checkInIfNeeded()를 1회 호출하고, 오늘 처음 출석한 것이면(=이전에 이미
// 출석했으면 다시 안 뜸) 이 모달로 축하 + 적립량을 보여준다. capModal(overlay/index.tsx)과 같은
// 카드 스타일 재사용.
export function DailyCheckInModal({ visible, earned, onDismiss }: { visible: boolean; earned: number; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Feather name="calendar" size={22} color={colors.successLight} />
          </View>
          <Text style={styles.title}>{t('checkIn.title')}</Text>
          <Text style={styles.message}>{t('checkIn.message', { earned })}</Text>
          <Pressable style={styles.btn} onPress={onDismiss}>
            <Text style={styles.btnText}>{t('checkIn.dismiss')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 340, backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.lg, alignItems: 'center', gap: spacing.xs },
  iconWrap: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  title: { color: colors.textPrimary, fontSize: 17, fontFamily: typography.bodyFontFamilyBold, textAlign: 'center' },
  message: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center', marginBottom: spacing.sm },
  btn: { alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: spacing.sm, alignItems: 'center' },
  btnText: { color: '#FFFFFF', fontFamily: typography.bodyFontFamilyBold, fontSize: 14 },
});
