import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { GlassSurface } from '../ui/GlassSurface';
import { useTranslation } from '../../services/i18n';
import { useToastStore } from '../../store/useToastStore';
import { radius, spacing, typography } from '../../constants/theme';
import { getSavedVideos, removeSavedVideo, updateSavedVideoMeta, type SavedVideo, type SavedVideoKind } from '../../database/repositories/savedVideosRepository';

// 2026-08-09 파리티 — 안드로이드 PaceOverlayService의 oEmbed 제목 보정과 동일 처치(videoId는 아는데
// title이 비어 저장된 행을 나중에 채운다). API 키 없이 쓸 수 있는 유튜브 공개 엔드포인트.
// 프로세스 수명 동안 이미 확인한 videoId는 기억해 목록을 다시 열 때마다 재요청하지 않는다.
const oembedCheckedVideoIds = new Set<string>();
async function fetchYouTubeOEmbed(videoId: string): Promise<{ title: string; channel: string | null } | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { title?: string; author_name?: string };
    if (!json.title) return null;
    return { title: json.title, channel: json.author_name ?? null };
  } catch {
    return null;
  }
}

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
  onOpenVideo,
}: {
  userId: string;
  kind: SavedVideoKind;
  onClose: () => void;
  // iOS 전용 — 피드가 현재 영상 정보를 직접 알아서(Android처럼 공유시트 캡처가 불필요) "현재 영상 추가"를
  // 넘겨준다. 주어졌을 때만 favorite 리스트 상단에 추가 버튼을 렌더한다. 추가 후 리스트 새로고침.
  onAddCurrent?: () => Promise<void> | void;
  // onOpenVideo(optional) — 제공되면 항목 탭 시 외부 브라우저(Safari) 대신 앱 내 피드에서 재생
  // (2026-08-01 사장님 지적). 미제공이면 기존 Linking(url) 폴백. playlist(2026-08-01 사장님 지시) —
  // Favorite 목록(표시 순서)의 videoId들을 함께 넘겨 피드가 이 리스트를 이어서 재생하게 한다(소진되면 유튜브 자동).
  onOpenVideo?: (videoId: string, playlist?: string[]) => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SavedVideo[]>([]);
  const [adding, setAdding] = useState(false);

  // 2026-08-09 파리티 — 안드로이드 PaceOverlayService.renderList()(커밋 2764d0b)와 동일 처치.
  // videoId도 url도 없는 "껍데기" 행은 재생도(onOpen) 공유도(onShare) 불가능하다(2026-08-05 이전에
  // videoId를 못 얻는 광고/특수 항목을 추가했을 때 쌓인 잔여). 둘 다 없을 때만 지운다 — 하나라도
  // 있으면 서로 복원 가능하므로(공유는 videoId→url, 열기는 url→videoId) 지우면 안 된다.
  const isBlank = (s?: string | null) => !s || s.trim().length === 0;

  // 2026-08-09 파리티 — videoId는 아는데 title이 빈 행을 oEmbed로 채운다(위 fetchYouTubeOEmbed 참고).
  // 이미 이번 프로세스에서 확인한 videoId는 건너뛴다(같은 행을 목록 열 때마다 재요청 안 함).
  const backfillBlankTitles = useCallback((list: SavedVideo[]) => {
    const targets = list.filter((v) => v.videoId && isBlank(v.title) && !oembedCheckedVideoIds.has(v.videoId));
    targets.forEach((v) => {
      const videoId = v.videoId!;
      oembedCheckedVideoIds.add(videoId);
      fetchYouTubeOEmbed(videoId).then((meta) => {
        if (!meta) return;
        updateSavedVideoMeta(v.id, meta.title, meta.channel).catch(() => {});
        setItems((prev) => prev.map((row) => (row.id === v.id ? { ...row, title: meta.title, channel: meta.channel } : row)));
      });
    });
  }, []);

  const reload = useCallback(() => {
    getSavedVideos(userId, kind).then((list) => {
      const shells = list.filter((v) => isBlank(v.videoId) && isBlank(v.url));
      const finalList = shells.length > 0 ? list.filter((v) => !(isBlank(v.videoId) && isBlank(v.url))) : list;
      if (shells.length > 0) shells.forEach((v) => removeSavedVideo(v.id).catch(() => {}));
      setItems(finalList);
      backfillBlankTitles(finalList);
    }).catch(() => setItems([]));
  }, [userId, kind, backfillBlankTitles]);

  useEffect(() => { reload(); }, [reload]);

  // 2026-08-09 사장님 지시 — "즐겨찾기에서 add 누르면 즐겨찾기 팝업이 없어지게" 해달라(안드가
  // Add 후 사용자를 유튜브로 되돌리는 것과 같은 취지 — 추가만 하고 목록을 띄운 채로 두지 않는다).
  // 추가 끝나면 목록을 새로고침할 필요도 없다(닫히므로) — reload() 대신 onClose().
  const handleAddCurrent = useCallback(async () => {
    if (!onAddCurrent || adding) return;
    setAdding(true);
    try { await onAddCurrent(); onClose(); } finally { setAdding(false); }
  }, [onAddCurrent, adding, onClose]);

  const onRemove = useCallback(async (id: string) => {
    // 낙관적 갱신 — 삭제는 실패해도 사용자 경험상 되돌릴 이유가 적다(다시 추가하면 그만).
    setItems((prev) => prev.filter((v) => v.id !== id));
    removeSavedVideo(id).catch(() => {});
  }, []);

  // 2026-08-05 사장님 지적("아이폰에 주소가 있는데도 안 열렸어") — 예전엔 videoId가 없으면 앱 안 재생을
  // 통째로 건너뛰고 외부 열기로 갔는데, 그 실패를 `.catch(() => {})`로 **조용히 삼켰다**. 그래서 주소가
  // 멀쩡히 있어도 눌렀을 때 아무 일도 안 일어나는 것처럼 보였다.
  // url에는 videoId가 들어 있으므로(우리가 저장할 때 .../shorts/<id> 형태로 넣는다) 거기서 뽑아내면
  // 대부분 앱 안에서 재생할 수 있다 — 굳이 앱 밖으로 내보낼 이유가 없다.
  const videoIdFromUrl = (url?: string | null): string | null => {
    if (!url) return null;
    const m = url.match(/(?:youtu\.be\/|shorts\/|[?&]v=)([\w-]{11})/);
    return m ? m[1] : null;
  };

  const onOpen = useCallback((item: SavedVideo) => {
    const vid = item.videoId ?? videoIdFromUrl(item.url);
    if (onOpenVideo && vid) {
      // Favorite 목록(표시 순서)에서 videoId를 아는 것만 순서대로 넘겨 피드가 이어서 재생하게 한다.
      const playlist = items
        .map((v) => v.videoId ?? videoIdFromUrl(v.url))
        .filter((id): id is string => !!id);
      onOpenVideo(vid, playlist);
      onClose();
      return;
    }
    if (!item.url) {
      // 주소도 videoId도 없는 항목 — 왜 안 되는지 알려준다(조용히 무시하지 않는다).
      useToastStore.getState().show(t('overlay.openFailed'));
      return;
    }
    Linking.openURL(item.url).catch(() => {
      useToastStore.getState().show(t('overlay.openFailed'));
    });
  }, [onOpenVideo, onClose, items, t]);

  // 🔴 2026-08-08 사장님 지적("애플 공유 안 되는 것 같다") — 예전엔 `if (!item.url) return;`이라
  //   url이 없는 행에서 **아무 반응 없이 조용히 끝났다.** 버튼이 죽은 것처럼 보이는데 원인을 알
  //   방법이 없다. url이 비어 있는 행은 실제로 존재한다(스와이프 모드 저장 등 videoId만 아는 경로,
  //   구버전 행). 안드로이드 즐겨찾기 "탭해서 열기"에서 2026-08-05에 고친 것과 같은 처치를 한다:
  //     ① url이 없으면 videoId로 주소를 만들어 쓴다
  //     ② 둘 다 없을 때만 토스트로 알린다(조용히 끝내지 않는다)
  //   ⚠️ message와 url을 **동시에 넘기지 않는다.** iOS 공유시트는 둘을 별개 항목으로 취급해
  //     같은 주소가 두 번 들어가는 앱이 있다(메모/메시지 등). iOS는 url만, 안드로이드는 message만
  //     쓰는 것이 각 플랫폼의 정상 사용법이다.
  const onShare = useCallback((item: SavedVideo) => {
    const url = item.url ?? (item.videoId ? `https://www.youtube.com/shorts/${item.videoId}` : null);
    if (!url) {
      useToastStore.getState().show(t('overlay.openFailed'));
      return;
    }
    Share.share(Platform.OS === 'ios' ? { url } : { message: url }).catch(() => {});
  }, [t]);

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
                {/* 🔴 2026-08-08 사장님 지적("Favorite에 있는 리스트 애플 공유 안 되는 것 같다") —
                    공유가 고장난 게 아니라 **iOS 즐겨찾기에는 공유 버튼이 아예 없었다.** 여기가
                    `kind === 'capture'`일 때만 공유 아이콘을 그리고, favorite에는 장식용 재생
                    아이콘만 뒀다.
                    안드로이드는 2026-07-31 지시("favorite도 공유가 되게")에 따라 **양쪽 리스트 모두**
                    공유 아이콘을 달아뒀는데(PaceOverlayService의 ⇪ 버튼) iOS만 반영이 안 된
                    파리티 갭이었다. 안드로이드와 동일하게 맞춘다.
                    재생 아이콘을 없애도 재생 동작은 그대로다 — 행 자체를 탭하면 재생된다(onOpen).
                    아이콘을 셋(공유/재생/삭제)으로 늘리면 좁은 행에서 터치 영역이 서로 먹는다. */}
                <Pressable onPress={() => onShare(item)} hitSlop={8} style={styles.rowAction} accessibilityRole="button" accessibilityLabel={t('overlay.shareAction')}>
                  <Feather name="share-2" size={16} color="rgba(255,255,255,0.75)" />
                </Pressable>
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
