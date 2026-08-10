import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { GlassSurface } from '../ui/GlassSurface';
import { useTranslation } from '../../services/i18n';
import { radius, spacing, typography } from '../../constants/theme';
import { useShortsSearchStore } from '../../store/useShortsSearchStore';
import type { YouTubeShort } from '../../types/models';

// 2026-08-10 파리티 — 안드 커밋 dd4dd06(P메뉴 → Search)의 iOS 이식. ShortsHotOverlay와 같은 뼈대
// (프리셋 칩 가로 스크롤 + 결과 목록) — 안드도 같은 구조로 만들었다. 자유 텍스트 검색 입력창은
// 안드도 아직 없다(오버레이가 FLAG_NOT_FOCUSABLE이라 IME 포커스 문제) — 프리셋만 이식.
export function ShortsSearchOverlay({ onClose, onOpenVideo }: {
  onClose: () => void;
  onOpenVideo?: (videoId: string, playlist?: string[]) => void;
}) {
  const { t } = useTranslation();
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const presets = useShortsSearchStore((s) => s.presets);
  const presetsLoading = useShortsSearchStore((s) => s.presetsLoading);
  const items: YouTubeShort[] = useShortsSearchStore((s) => (activeQuery ? s.results[activeQuery] : undefined)) ?? [];
  const loading = useShortsSearchStore((s) => (activeQuery ? s.resultsLoading[activeQuery] : false)) ?? false;

  useEffect(() => {
    useShortsSearchStore.getState().loadPresets();
  }, []);

  const onPickPreset = (query: string) => {
    setActiveQuery(query);
    useShortsSearchStore.getState().search(query);
  };

  const onOpen = (item: YouTubeShort) => {
    // HOT과 동일 규칙(안드 지시대로) — 지금 검색 결과 순서를 이어서재생 큐로 넘긴다.
    if (onOpenVideo) { onOpenVideo(item.videoId, items.map((i) => i.videoId)); onClose(); }
    else Linking.openURL(`https://www.youtube.com/shorts/${item.videoId}`).catch(() => {});
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

          {presetsLoading && presets.length === 0 ? (
            <ActivityIndicator color="rgba(255,255,255,0.6)" style={{ paddingVertical: spacing.md }} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsContent}>
              {presets.map((preset) => (
                <Pressable
                  key={preset.query}
                  onPress={() => onPickPreset(preset.query)}
                  style={[styles.tab, activeQuery === preset.query && styles.tabActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: activeQuery === preset.query }}
                >
                  <Text style={[styles.tabLabel, activeQuery === preset.query && styles.tabLabelActive]}>{preset.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {!activeQuery ? (
              <Text style={styles.emptyText}>{t('overlay.searchPickPreset')}</Text>
            ) : loading && items.length === 0 ? (
              <ActivityIndicator color="rgba(255,255,255,0.6)" style={{ paddingVertical: spacing.lg }} />
            ) : items.length === 0 ? (
              <Text style={styles.emptyText}>{t('overlay.hotEmpty')}</Text>
            ) : (
              items.map((item) => (
                <Pressable key={item.videoId} style={styles.row} onPress={() => onOpen(item)} accessibilityRole="button">
                  {item.thumbnailUrl ? (
                    <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.thumb, styles.thumbFallback]}>
                      <Feather name="film" size={16} color="rgba(255,255,255,0.4)" />
                    </View>
                  )}
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={2}>{item.title || '—'}</Text>
                    {!!item.channelTitle && <Text style={styles.rowChannel} numberOfLines={1}>{item.channelTitle}</Text>}
                  </View>
                  <Feather name="play-circle" size={16} color="rgba(255,255,255,0.5)" style={styles.rowAction} />
                </Pressable>
              ))
            )}
          </ScrollView>
        </GlassSurface>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: spacing.lg,
    marginTop: 90,
    maxHeight: '72%',
    borderRadius: radius.cardLarge,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    padding: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold },
  tabs: { flexGrow: 0, marginBottom: spacing.sm },
  tabsContent: { gap: 8, paddingRight: spacing.md },
  tab: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  tabActive: { backgroundColor: 'rgba(255,255,255,0.9)' },
  tabLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontFamily: typography.bodyFontFamilySemibold },
  tabLabelActive: { color: '#111111' },
  list: { flexGrow: 0 },
  emptyText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  thumb: { width: 56, height: 56, borderRadius: radius.card, backgroundColor: 'rgba(255,255,255,0.08)' },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: '#FFFFFF', fontSize: 13, fontFamily: typography.bodyFontFamilySemibold, lineHeight: 17 },
  rowChannel: { color: 'rgba(255,255,255,0.55)', fontSize: 11 },
  rowAction: { padding: 6 },
});
