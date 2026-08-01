import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { GlassSurface } from '../ui/GlassSurface';
import { useTranslation, type TranslationKey } from '../../services/i18n';
import { radius, spacing, typography } from '../../constants/theme';
import { SHORTS_HOT_CATEGORIES, type ShortsHotVideo } from '../../services/api/client';
import { useShortsHotStore } from '../../store/useShortsHotStore';

// 2026-08-01 사장님 지시 — 오버레이 P 메뉴 "Shorts HOT"의 iOS(인앱 RN) 구현. Android는 네이티브
// (PaceOverlayService.kt의 showShortsHotList)로 같은 백엔드를 그리고, iOS는 여기서 SavedVideoListOverlay와
// 동일한 글래스모피즘 리스트 + 상단 카테고리 탭으로 그린다(백엔드/데이터는 공용, UI만 플랫폼별).
const CATEGORY_LABEL_KEY: Record<string, TranslationKey> = {
  all: 'overlay.hotCatAll',
  music: 'overlay.hotCatMusic',
  gaming: 'overlay.hotCatGaming',
  comedy: 'overlay.hotCatComedy',
  entertainment: 'overlay.hotCatEntertainment',
  pets: 'overlay.hotCatPets',
};

export function ShortsHotOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<string>('all');
  // 프리페치 스토어에서 캐시를 먼저 읽어 즉시 표시(stale-while-revalidate) — 앱 시작 시 'all'은 이미
  // 프리페치돼 있어 로딩 없이 뜬다. 탭 변경/재방문 시 백그라운드로 최신화.
  // ⚠️ 셀렉터가 `?? []`로 매번 새 배열을 반환하면 useSyncExternalStore가 "스냅샷이 계속 바뀐다"고
  // 판단해 무한 리렌더("Maximum update depth")로 앱이 죽는다. 셀렉터는 stable 참조(undefined 또는
  // 캐시 배열)만 반환하고, 기본값 처리는 밖에서 한다.
  const items = useShortsHotStore((s) => s.cache[category]) ?? [];
  const loading = useShortsHotStore((s) => s.loading[category]) ?? false;

  useEffect(() => {
    useShortsHotStore.getState().fetch(category);
  }, [category]);

  const onOpen = (item: ShortsHotVideo) => {
    Linking.openURL(`https://www.youtube.com/shorts/${item.videoId}`).catch(() => {});
  };

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="none">
      <Pressable onPress={(e) => e.stopPropagation()}>
        <GlassSurface style={styles.panel} intensity={55}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('overlay.menuHot')}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('overlay.close')}>
              <Feather name="x" size={18} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsContent}>
            {SHORTS_HOT_CATEGORIES.map((cat) => (
              <Pressable
                key={cat}
                onPress={() => setCategory(cat)}
                style={[styles.tab, category === cat && styles.tabActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: category === cat }}
              >
                <Text style={[styles.tabLabel, category === cat && styles.tabLabelActive]}>{t(CATEGORY_LABEL_KEY[cat])}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {loading && items.length === 0 ? (
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
                    {!!item.channel && <Text style={styles.rowChannel} numberOfLines={1}>{item.channel}</Text>}
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
