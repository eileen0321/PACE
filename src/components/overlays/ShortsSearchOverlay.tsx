import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { GlassSurface } from '../ui/GlassSurface';
import { useTranslation } from '../../services/i18n';
import { radius, spacing, typography } from '../../constants/theme';
import { useShortsSearchStore } from '../../store/useShortsSearchStore';
import * as Localization from 'expo-localization';
import type { YouTubeShort } from '../../types/models';

// 검색어에 붙일 "쇼츠" 단어 — 국가별 결과로 밀기 위한 것(onSubmitQuery 주석 참고).
// 안드(PaceOverlayService.submitSearch)와 같은 표를 유지할 것.
const LOCALE_SHORTS_WORD: Record<string, string> = { ko: '쇼츠', ja: 'ショート', en: 'shorts' };

// 2026-08-10 파리티 — 안드 커밋 dd4dd06(P메뉴 → Search)의 iOS 이식. ShortsHotOverlay와 같은 뼈대
// (프리셋 칩 가로 스크롤 + 결과 목록) — 안드도 같은 구조로 만들었다.
// 🔴 2026-08-11 — 자유 텍스트 검색 입력창을 양쪽 다 붙였다(사장님 지적 "검색어 입력 기능 넣자고
// 했는데 너 뭐 했어?"). 위 주석은 "안드도 아직 없다"였는데 그건 이제 사실이 아니다 — 안드는
// PaceOverlayService.showSearchPanel에 EditText가 들어갔다(그 창의 FLAG_NOT_FOCUSABLE을 빼야
// IME가 떴다 — 실기기에서 확인, 그쪽 주석 참고).
export function ShortsSearchOverlay({ onClose, onOpenVideo, initialQuery }: {
  onClose: () => void;
  onOpenVideo?: (videoId: string, playlist?: string[]) => void;
  /** __DEV__ 홍보 녹화(feed promoSearch) 전용 — 마운트 즉시 이 검색어로 검색해 결과를 보여준다. */
  initialQuery?: string;
}) {
  const { t } = useTranslation();
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const presets = useShortsSearchStore((s) => s.presets);
  const presetsLoading = useShortsSearchStore((s) => s.presetsLoading);
  const items: YouTubeShort[] = useShortsSearchStore((s) => (activeQuery ? s.results[activeQuery] : undefined)) ?? [];
  const loading = useShortsSearchStore((s) => (activeQuery ? s.resultsLoading[activeQuery] : false)) ?? false;

  useEffect(() => {
    useShortsSearchStore.getState().loadPresets();
  }, []);

  useEffect(() => {
    if (!initialQuery) return;
    setDraft(initialQuery);
    setActiveQuery(initialQuery);
    useShortsSearchStore.getState().search(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickPreset = (query: string) => {
    setActiveQuery(query);
    useShortsSearchStore.getState().search(query);
  };

  // 🔴 2026-08-11 사장님 지적("cat을 쓰면 우리나라 쇼츠에서 찾아야 하지 않아?") — 실기기(안드)에서
  //   "cat"을 치니 결과가 전부 영어권 쇼츠였다. gl/hl은 이미 보내지만 그건 편향일 뿐이라 영어 단어를
  //   던지면 영어권 결과가 이긴다. 서버 프리셋이 이미 '축구 쇼츠'처럼 로케일 단어를 붙여 같은 문제를
  //   풀고 있으므로(api/search-presets.ts), 자유 검색도 같은 규칙을 따른다.
  //   ⚠️ 이미 그 단어가 들어 있으면 중복으로 안 붙인다("고양이 쇼츠 쇼츠" 방지).
  const onSubmitQuery = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    //   ⚠️ 2026-08-11(2차) 사장님 지적("다른 나라에서도 그 나라 쇼츠에서 검색이 되게 해야지") —
    //     앱 i18n은 en/ko뿐이라 t()에만 기대면 일본 사용자가 "shorts"를 받아 일본 쇼츠를 못 찾는다.
    //     검색 API는 ja/JP를 지원하므로(client.ts의 gl/hl) **기기 언어**로 직접 고른다.
    //     안드도 같은 표를 쓴다(PaceOverlayService.submitSearch).
    const suffix = LOCALE_SHORTS_WORD[Localization.getLocales()[0]?.languageCode ?? 'en'] ?? 'shorts';
    const expanded = q.toLowerCase().includes(suffix.toLowerCase()) ? q : `${q} ${suffix}`;
    setActiveQuery(expanded);
    useShortsSearchStore.getState().search(expanded);
  };

  const onOpen = (item: YouTubeShort) => {
    // 🔴 2026-08-11 사장님 지적("양다일 검색하고 선택해서 보면 쇼츠가 맘대로 지나가버리던데") —
    //   안드 실기기 logcat으로 재현 확정(14초·2초 만에 다음 영상으로 넘어가고 광고까지 큐를 탔다).
    //   예전엔 HOT과 같은 규칙으로 검색 결과 전체를 이어서재생 큐(playlist 인자)로 넘겼는데,
    //   검색은 성격이 다르다 — 특정 영상을 고른 건 **그걸 보겠다**는 뜻이지 결과를 쭉 틀어달라는
    //   뜻이 아니다. 즐겨찾기에서 이미 같은 판단을 했다("HOT은 이어서재생이 맞지만 즐겨찾기는
    //   그것만 재생", 2026-08-09 지시). 검색도 그쪽이다 — playlist를 넘기지 않는다.
    //   (안드도 같은 날 동일하게 고쳤다: PaceOverlayService의 검색 결과 탭 핸들러.)
    if (onOpenVideo) { onOpenVideo(item.videoId); onClose(); }
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

          {/* 🔴 2026-08-11 사장님 지적("검색어 입력 기능 넣자고 했는데 너 뭐 했어?") — 지금까지
              프리셋 칩만 있고 검색어를 직접 칠 자리가 없었다. 실행 경로(useShortsSearchStore.search)는
              이미 있었고 **입력창만** 빠져 있던 것이라 그 조각을 붙인다. 안드도 같은 날 같이 붙였다
              (PaceOverlayService.showSearchPanel의 EditText). */}
          {/* 🔴 2026-08-11 사장님 지적("글자는 쳤는데 뭘로 엔터 역할을 하는데") — 키보드의 검색 키
              하나뿐이면 키보드를 내렸을 때 실행할 방법이 없고, 그 키가 검색 버튼인지도 화면상
              알 수 없다. 눈에 보이는 버튼을 옆에 둔다(안드도 같이 넣었다). */}
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder={t('overlay.searchPlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.4)"
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => onSubmitQuery(draft)}
            />
            <Pressable style={styles.searchButton} onPress={() => onSubmitQuery(draft)} accessibilityRole="button">
              <Text style={styles.searchButtonText}>{t('overlay.searchGo')}</Text>
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
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
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
    marginBottom: spacing.sm,
  },
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
