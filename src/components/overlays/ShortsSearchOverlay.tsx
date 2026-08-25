import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { GlassSurface } from '../ui/GlassSurface';
import { useTranslation } from '../../services/i18n';
import { radius, spacing, typography } from '../../constants/theme';
import { recordSearch, useShortsSearchStore } from '../../store/useShortsSearchStore';
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
    recordSearch(initialQuery); // 검색 실행은 실행 — 최근검색 시드의 E2E 검증도 이 경로로 한다
    useShortsSearchStore.getState().search(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickPreset = (query: string) => {
    setActiveQuery(query);
    recordSearch(query); // 2026-08-25 — 최근 검색 기반 피드 시작 시드의 근거(스토어 주석 참고)
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
    recordSearch(expanded); // 2026-08-25 — 최근 검색 기반 피드 시작 시드의 근거(스토어 주석 참고)
    useShortsSearchStore.getState().search(expanded);
  };

  const onOpen = (item: YouTubeShort) => {
    // 🔴 2026-08-25 사장님 지시 번복("쇼츠 검색하고 난 다음엔 검색이 기준으로 계속 플레이 되어야
    //   하는데 왜 중간에 딴 거로 계속 바뀌는데") — playlist를 다시 넘긴다(검색 결과 순서 이어재생,
    //   소진 시 유튜브 자동). 8/11의 "고른 것만 재생"(playlist 제거)은 당시 재생이 2~14초 만에
    //   멋대로 순삭되던 것에 대한 조치였는데, 그 순삭의 진짜 원인은 안드 CHAIN 워처의 조기 발화였지
    //   playlist 자체가 아니다. iOS forcedList는 자연 종료/손짓에만 넘어가므로 순삭이 없다 —
    //   "검색 맥락 유지 + 내 페이스로 넘김"이 두 지시를 모두 만족하는 형태다. (안드 쪽도 동일하게
    //   되돌리되 CHAIN 조기 발화 수정은 유지해야 한다 — PM MD에 기록.)
    if (onOpenVideo) {
      // 🔴 2026-08-25 사장님("검색어로 영상이 나오다 자꾸 다른 이상한 걸로 바뀐다") —
      //   피드는 playlist에서 **누른 항목의 인덱스부터** 재생한다(feed/index.tsx의 forcedIndexRef).
      //   그래서 목록 끝쪽 결과를 누르면 남은 항목이 한두 개뿐이고, 금방 소진돼 유튜브 일반 피드로
      //   넘어간다 — 검색과 무관한 영상이 바로 나오는 게 그 경로다. 25개를 받아놓고 몇 개만 쓰고 있었다.
      //   → 누른 항목이 맨 앞에 오도록 **회전**시켜 넘긴다. 검색 결과 전체를 다 쓴 뒤에 유튜브로
      //     넘어가므로 "관련 영상이 계속 나온다". 순서만 바뀔 뿐 목록 자체는 그대로다.
      const ids = items.map((i) => i.videoId);
      const at = ids.indexOf(item.videoId);
      const rotated = at > 0 ? [...ids.slice(at), ...ids.slice(0, at)] : ids;
      onOpenVideo(item.videoId, rotated);
      onClose();
    }
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
