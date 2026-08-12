import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { GlassSurface } from '../ui/GlassSurface';
import { useTranslation } from '../../services/i18n';
import { radius, spacing, typography } from '../../constants/theme';

// QA_MATRIX.md 1-4b(안드 → 맥 세션 요청, 2026-08-13) — 틱톡은 검색 결과 API가 서명(X-Bogus/
// msToken)을 요구해 우리가 목록을 만들 수 없다(ShortsSearchOverlay처럼 프리셋+결과 리스트를
// 보여줄 수 없음). 안드로이드는 이미 "입력만 우리 UI로 받고 결과는 틱톡 앱 검색 화면에 맡긴다"로
// 풀었다(PaceOverlayService.submitSearch → isTikTokContext → openTikTokSearch 딥링크). iOS는
// 딥링크로 앱을 나가는 대신 이미 떠 있는 같은 WebView를 틱톡 검색 URL로 이동시키는 방식(같은
// 원칙, 다른 구현 — WebView 안에서는 크롬이 안 뜬다).
export function TikTokSearchOverlay({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (query: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  const submit = () => {
    const q = draft.trim();
    if (!q) return;
    onSubmit(q);
    onClose();
  };

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="none">
      <Pressable onPress={(e) => e.stopPropagation()}>
        <GlassSurface style={styles.panel} intensity={55}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('overlay.menuSearch')}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('overlay.close')}>
              <Feather name="x" size={18} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>
          <Text style={styles.hint}>{t('overlay.tiktokSearchHint')}</Text>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder={t('overlay.searchPlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.4)"
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              autoFocus
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={submit}
            />
            <Pressable style={styles.searchButton} onPress={submit} accessibilityRole="button">
              <Text style={styles.searchButtonText}>{t('overlay.searchGo')}</Text>
            </Pressable>
          </View>
        </GlassSurface>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: spacing.lg,
    marginTop: 90,
    borderRadius: radius.cardLarge,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    padding: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold },
  hint: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginBottom: spacing.sm, lineHeight: 17 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  searchButton: { backgroundColor: '#6C5CE7', borderRadius: radius.card, paddingHorizontal: spacing.md, paddingVertical: 10 },
  searchButtonText: { color: '#FFFFFF', fontSize: 13, fontFamily: typography.bodyFontFamilyBold },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: typography.bodyFontFamily,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.card,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
  },
});
