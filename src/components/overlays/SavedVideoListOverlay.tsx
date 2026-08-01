import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { GlassSurface } from '../ui/GlassSurface';
import { useTranslation } from '../../services/i18n';
import { radius, spacing, typography } from '../../constants/theme';
import { getSavedVideos, removeSavedVideo, type SavedVideo, type SavedVideoKind } from '../../database/repositories/savedVideosRepository';

// 2026-07-31 사장님 지시 — Favorite/Capture 둘 다 같은 모양의 글래스모피즘 리스트 오버레이를 쓴다.
// Capture는 각 행 옆에 외부 공유 아이콘, Favorite는 행 자체를 탭하면 다시 재생(둘 다 원본 유튜브
// 링크로 이동 — 우리가 영상을 다시 호스팅하지 않음, 링크만 저장).
// 2026-07-31 실기기 발견 — "현재 영상 추가" 버튼을 원래 여기(리스트 화면 안)에 뒀었는데, 이 화면에
// 도달했을 땐 이미 Pace가 전경이라 유튜브가 백그라운드로 밀린 뒤라서 캡처가 구조적으로 항상
// 실패했다(PaceAccessibilityService가 더 이상 유튜브 창을 못 찾음). 캡처는 이제 오버레이 P 메뉴
// 자체에서(유튜브가 아직 전경일 때) 끝내고 그 결과를 딥링크로 넘겨받아 quick-list.tsx가 자동
// 저장한다 — 여기선 그 결과로 채워진 목록을 "보여주기"만 한다.
export function SavedVideoListOverlay({
  userId,
  kind,
  onClose,
  onAddCurrent,
}: {
  userId: string;
  kind: SavedVideoKind;
  onClose: () => void;
  // iOS 전용 — 피드가 현재 영상 정보를 직접 알아서(Android처럼 공유시트 캡처가 불필요) "현재 영상 추가"를
  // 넘겨준다. 주어졌을 때만 favorite 리스트 상단에 추가 버튼을 렌더한다. 추가 후 리스트 새로고침.
  onAddCurrent?: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SavedVideo[]>([]);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(() => {
    getSavedVideos(userId, kind).then(setItems).catch(() => setItems([]));
  }, [userId, kind]);

  useEffect(() => { reload(); }, [reload]);

  const handleAddCurrent = useCallback(async () => {
    if (!onAddCurrent || adding) return;
    setAdding(true);
    try { await onAddCurrent(); reload(); } finally { setAdding(false); }
  }, [onAddCurrent, adding, reload]);

  const onRemove = useCallback(async (id: string) => {
    // 낙관적 갱신 — 삭제는 실패해도 사용자 경험상 되돌릴 이유가 적다(다시 추가하면 그만).
    setItems((prev) => prev.filter((v) => v.id !== id));
    removeSavedVideo(id).catch(() => {});
  }, []);

  const onOpen = useCallback((item: SavedVideo) => {
    if (!item.url) return;
    Linking.openURL(item.url).catch(() => {});
  }, []);

  const onShare = useCallback((item: SavedVideo) => {
    if (!item.url) return;
    Share.share({ message: item.url, url: item.url }).catch(() => {});
  }, []);

  const title = kind === 'capture' ? t('overlay.captureListTitle') : t('overlay.favoriteListTitle');
  const emptyText = kind === 'capture' ? t('overlay.captureListEmpty') : t('overlay.favoriteListEmpty');

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="none">
      <Pressable onPress={(e) => e.stopPropagation()}>
        <GlassSurface style={styles.panel} intensity={55}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('overlay.close')}>
              <Feather name="x" size={18} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>

          {onAddCurrent && kind === 'favorite' && (
            <Pressable onPress={handleAddCurrent} disabled={adding} style={[styles.addCurrentBtn, adding && styles.addCurrentBtnDisabled]} accessibilityRole="button" accessibilityLabel={t('overlay.addCurrentToFavorite')}>
              <Feather name="plus" size={16} color="#111111" />
              <Text style={styles.addCurrentText}>{t('overlay.addCurrentToFavorite')}</Text>
            </Pressable>
          )}

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {items.length === 0 && <Text style={styles.emptyText}>{emptyText}</Text>}
            {items.map((item) => (
              <Pressable
                key={item.id}
                style={styles.row}
                onPress={() => (kind === 'favorite' ? onOpen(item) : undefined)}
                accessibilityRole={kind === 'favorite' ? 'button' : 'none'}
              >
                {item.thumbnailUrl ? (
                  <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbFallback]}>
                    <Feather name="film" size={16} color="rgba(255,255,255,0.4)" />
                  </View>
                )}
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{item.title ?? '—'}</Text>
                  {!!item.channel && <Text style={styles.rowChannel} numberOfLines={1}>{item.channel}</Text>}
                </View>
                {kind === 'capture' ? (
                  <Pressable onPress={() => onShare(item)} hitSlop={8} style={styles.rowAction} accessibilityRole="button" accessibilityLabel={t('overlay.shareAction')}>
                    <Feather name="share-2" size={16} color="rgba(255,255,255,0.75)" />
                  </Pressable>
                ) : (
                  <Feather name="play-circle" size={16} color="rgba(255,255,255,0.5)" style={styles.rowAction} />
                )}
                <Pressable onPress={() => onRemove(item.id)} hitSlop={8} style={styles.rowRemove} accessibilityRole="button" accessibilityLabel={t('overlay.removeAction')}>
                  <Feather name="x" size={14} color="rgba(255,255,255,0.4)" />
                </Pressable>
              </Pressable>
            ))}
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
    maxHeight: '70%',
    borderRadius: radius.cardLarge,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    padding: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  addCurrentBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: radius.pill, paddingVertical: 10, marginBottom: spacing.sm },
  addCurrentBtnDisabled: { opacity: 0.5 },
  addCurrentText: { color: '#111111', fontSize: 13, fontFamily: typography.bodyFontFamilyExtrabold },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold },
  list: { flexGrow: 0 },
  emptyText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  thumb: { width: 56, height: 56, borderRadius: radius.card, backgroundColor: 'rgba(255,255,255,0.08)' },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: '#FFFFFF', fontSize: 13, fontFamily: typography.bodyFontFamilySemibold, lineHeight: 17 },
  rowChannel: { color: 'rgba(255,255,255,0.55)', fontSize: 11 },
  rowAction: { padding: 6 },
  rowRemove: { padding: 4 },
});
