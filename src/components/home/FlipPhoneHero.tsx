import { Image, StyleSheet, View } from 'react-native';

// 2026-08-01 사용자 지시("폰색 보라나 앱과 친화적인 색으로") — phone05.png(브라운)를 앱 브랜드
// 컬러(#5856D6 계열)에 맞춘 phone10.png(퍼플)로 교체. 로고/워드마크 없는 제네릭 3D 렌더 폰
// 목업이라 상표 리스크 없음(phone05와 동일 원칙).
const IMAGE = require('../../../assets/phone10.png');

// 2026-07-28 사장님 지시("모션 효과 넣지 말아봐 촌스럽잖아 더" / "폰 감싸는 원이 더 촌스러운듯" /
// "출시해야 하는데 힘쓰지 말자") — 모션, 배경 원(vignette) 전부 제거. 폰 뒷면 이미지만 정적으로 표시.
export function FlipPhoneHero() {
  return (
    <View style={styles.wrap}>
      <Image source={IMAGE} style={styles.image} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 240, height: 220, alignItems: 'center', justifyContent: 'center' },
  image: { width: 208, height: 188 },
});
