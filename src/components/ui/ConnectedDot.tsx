import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// 블루투스 공식 브랜드 색(파란색) — 사장님 지시("bt는 파란색으로") — 앱 테마의 success(초록)는
// "연결됨"이라는 일반 의미라 블루투스 특유의 색과는 다르다. 아이콘 자체가 이미 블루투스 마크라
// 색까지 파란색이면 "이게 블루투스구나"가 한눈에 더 명확해진다.
const BLUETOOTH_BLUE = '#3399FF';

// 2026-08-13 도입(focus.tsx, 처음엔 단순 점). 2026-08-15 공용 컴포넌트로 추출 — 홈 카드/Focus 탭/
// 피드 화면이 전부 같은 기호(연결=초록 펄스 / 미연결=회색 정적)를 쓴다.
// 🔴 2026-08-15(2차) 사장님 지적("점들 구분이 안 돼, 블루투스 마크로 바꿔줘 — 블루투스가 번쩍거려야
// 블루투스 연결인 거 알잖아") — 피드 화면에 점이 3개(iOS 카메라 사용중 시스템 점 / FOCUS ON 필 안
// 모드표시 점 / 이 리모컨 점)나 겹쳐 보여서 단순 원형 점으로는 뭐가 뭔지 구분이 안 됐다. 블루투스
// 글리프로 바꿔 의미가 아이콘 자체로 드러나게 한다(펄스 애니메이션은 유지).
// iOS는 이게 정적 연결 판정이 아니라 "최근 리모컨 활동 감지" 신호라 항상 정확하진 않다
// (bluetoothService.ios.ts 주석 참고) — Android는 InputDevice 기반 정적 판정이라 그대로 정확하다.
export function ConnectedDot({ connected }: { connected: boolean }) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (!connected) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.3, duration: 500, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, connected]);
  return (
    <Animated.View style={{ opacity: connected ? pulse : 0.5 }}>
      <Ionicons name="bluetooth" size={10} color={connected ? BLUETOOTH_BLUE : 'rgba(255,255,255,0.4)'} />
    </Animated.View>
  );
}
