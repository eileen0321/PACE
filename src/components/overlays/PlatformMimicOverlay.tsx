import { Feather, Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { sourceColors } from '../../constants/theme';
import type { CuratedVideo } from '../../constants/curatedVideos';
import type { AppShieldTarget } from '../../types/models';

// healthy-shorts-assistant(3) ShortsPlayer.tsx의 "DYNAMIC TOP OVERLAYS / METADATA / SIDEBARS BY
// SOURCE"(ShortsPlayer.tsx:1036~1250대)를 이식 — 플랫폼별(YouTube/Instagram/TikTok) 상단바 +
// 하단 메타데이터(아바타/작성자/캡션/음악) + 우측 액션 레일. 단, 개발용 시뮬레이터 콘텐츠(overlay/
// index.tsx의 simContent)에만 쓰인다 — 실제 프로덕션에서는 진짜 YouTube/Instagram/TikTok 앱이 이
// 자리를 대체하므로 절대 보이지 않는다.
//
// 원본과 다른 점(의도적): 좋아요/댓글/공유 옆에 붙어있던 "124K"/"1.2K" 같은 숫자, 구독/팔로우 버튼의
// on/off 토글 상태는 전부 뺐다 — 진짜 데이터가 아닌 걸 그럴듯한 숫자로 보여주면 이 세션 내내 지켜온
// "가짜 데이터로 안 남긴다" 원칙과 충돌한다. 아이콘/레이아웃만 플랫폼별로 다르게 재현.
export function PlatformMimicOverlay({ platform, video }: { platform: AppShieldTarget; video: CuratedVideo }) {
  return (
    <>
      <View style={styles.topBar} pointerEvents="none">
        {platform === 'youtube' && (
          <>
            <View style={styles.ytBadge}>
              <View style={styles.ytPlayChip}>
                <Ionicons name="play" size={8} color="#FFFFFF" />
              </View>
              <Text style={styles.ytBadgeText}>Shorts</Text>
            </View>
            <View style={styles.topIconRow}>
              <Feather name="search" size={18} color="#FFFFFF" />
              <Feather name="more-vertical" size={18} color="#FFFFFF" />
            </View>
          </>
        )}
        {platform === 'instagram' && (
          <>
            <View style={styles.topIconRow}>
              <Text style={styles.igWordmark}>Instagram</Text>
              <Feather name="chevron-down" size={14} color="#FFFFFF" />
            </View>
            <View style={styles.topIconRow}>
              <Ionicons name="paper-plane-outline" size={18} color="#FFFFFF" />
            </View>
          </>
        )}
        {platform === 'tiktok' && (
          <>
            <View style={styles.ttSpacer} />
            <View style={styles.topIconRow}>
              <Text style={styles.ttTabInactive}>Following</Text>
              <View style={styles.ttTabActiveWrap}>
                <Text style={styles.ttTabActive}>For You</Text>
                <View style={styles.ttTabUnderline} />
              </View>
            </View>
            <Feather name="search" size={18} color="#FFFFFF" />
          </>
        )}
      </View>

      <View style={styles.metaWrap} pointerEvents="none">
        <View style={styles.creatorRow}>
          <View style={[styles.avatar, { backgroundColor: sourceColors[platform === 'tiktok' ? 'tiktok' : platform].accent }]}>
            <Text style={styles.avatarText}>{video.creator.slice(1, 3).toUpperCase()}</Text>
          </View>
          <Text style={styles.creatorName}>{video.creator}</Text>
          {platform !== 'tiktok' && (
            <View style={styles.followBadge}>
              <Text style={styles.followBadgeText}>{platform === 'youtube' ? 'SUBSCRIBE' : 'Follow'}</Text>
            </View>
          )}
        </View>
        <Text style={styles.caption} numberOfLines={2}>
          {video.title} — {video.description}
        </Text>
        <View style={styles.musicRow}>
          <Ionicons name="musical-notes" size={12} color="#FFFFFF" />
          <Text style={styles.musicText} numberOfLines={1}>Original Sound · {video.creator}</Text>
        </View>
      </View>

      <View style={styles.actionRail} pointerEvents="none">
        <View style={styles.actionItem}>
          <View style={styles.actionIconWrap}>
            <Feather name="thumbs-up" size={18} color="#FFFFFF" />
          </View>
        </View>
        <View style={styles.actionItem}>
          <View style={styles.actionIconWrap}>
            <Feather name="message-circle" size={18} color="#FFFFFF" />
          </View>
        </View>
        <View style={styles.actionItem}>
          <View style={styles.actionIconWrap}>
            <Feather name="share" size={18} color="#FFFFFF" />
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  topBar: { position: 'absolute', top: 16, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 20 },
  topIconRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ytBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  ytPlayChip: { width: 16, height: 12, borderRadius: 3, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center' },
  ytBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  igWordmark: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  ttSpacer: { width: 40 },
  ttTabInactive: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '700' },
  ttTabActiveWrap: { alignItems: 'center' },
  ttTabActive: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  ttTabUnderline: { marginTop: 4, width: 16, height: 2, borderRadius: 1, backgroundColor: '#25F4EE' },

  metaWrap: { position: 'absolute', left: 16, right: 64, bottom: 40, gap: 10, zIndex: 20 },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  creatorName: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  followBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.15)' },
  followBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  caption: { color: '#F3F4F6', fontSize: 12, fontWeight: '600', lineHeight: 17, maxWidth: 260 },
  musicRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  musicText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', maxWidth: 170 },

  actionRail: { position: 'absolute', right: 12, bottom: 48, alignItems: 'center', gap: 18, zIndex: 20 },
  actionItem: { alignItems: 'center' },
  actionIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
});
