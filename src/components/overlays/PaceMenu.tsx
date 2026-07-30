import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { GlassSurface } from '../ui/GlassSurface';
import { useTranslation } from '../../services/i18n';
import { radius, spacing, typography } from '../../constants/theme';

export type PaceMenuAction = 'app' | 'hot' | 'capture' | 'favorite';

// 2026-07-31 사장님 지시 — 오버레이 우상단 "P" 아이콘을 누르면 이 4개 메뉴(앱으로/Shorts HOT/
// Saved/Favorite)가 글래스모피즘 투명 박스로 뜬다. 첨부 레퍼런스 이미지(어두운 배경 + 은은한
// 글로우 외곽선 카드)에 맞춰 GlassSurface(실제 블러, iOS/Android 둘 다 진짜 블러 렌더링 —
// 2026-07-27 재작성분) 위에 얇은 반투명 테두리만 추가해 "떠 있는 유리판" 느낌을 낸다.
export function PaceMenu({ onSelect, onClose, top }: { onSelect: (action: PaceMenuAction) => void; onClose: () => void; top: number }) {
  const { t } = useTranslation();
  const items: { action: PaceMenuAction; icon: keyof typeof Feather.glyphMap; label: string }[] = [
    { action: 'app', icon: 'smartphone', label: t('overlay.menuOpenApp') },
    { action: 'hot', icon: 'trending-up', label: t('overlay.menuHot') },
    { action: 'capture', icon: 'bookmark', label: t('overlay.menuCapture') },
    { action: 'favorite', icon: 'star', label: t('overlay.menuFavorite') },
  ];
  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="none">
      <GlassSurface style={[styles.menu, { top }]} intensity={50}>
        {items.map((item, i) => (
          <Pressable
            key={item.action}
            style={[styles.item, i < items.length - 1 && styles.itemDivider]}
            onPress={() => onSelect(item.action)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            <Feather name={item.icon} size={16} color="#FFFFFF" />
            <Text style={styles.itemLabel}>{item.label}</Text>
          </Pressable>
        ))}
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    right: spacing.md,
    width: 190,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 13, paddingHorizontal: spacing.md },
  itemDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
  itemLabel: { color: '#FFFFFF', fontSize: 14, fontFamily: typography.bodyFontFamilySemibold },
});
