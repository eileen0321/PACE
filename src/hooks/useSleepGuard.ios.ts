import { useCallback, useEffect, useRef, useState } from 'react';
import { requireNativeModule } from 'expo-modules-core';

// iOS 취침 감지 가드 (스펙 §4-B) — 피드 시청 중 잠들면 강제 종료를 트리거한다.
// 2026-08-04 안드로이드 2단계 재설계 패리티 포팅(PaceOverlayService.kt evaluateSleepStages, 커밋
// 6616521/c6481e4/1917234) — 이 파일이 8/2에 SLEEP_DETECTION_DISABLED로 껐던 옛 "가속도계 무진동
// 단독판정"을 대체한다. 안드가 그 방식을 버린 이유(폰을 책상/거치대에 두고 손가락만 스와이프하는
// 흔한 패턴에서 폰이 안 움직여 오탐)는 iOS도 똑같이 겪던 문제라(위 SLEEP_DETECTION_DISABLED 주석
// 참고), 판정 축을 안드와 동일하게 "사용자 입력 부재"로 옮긴다.
//
// AWAKE → SUSPECT(무입력 stillnessMinutes분) → CONFIRM(+5분 더 + 밤시간대 22~09 + 보조신호 1개 이상)
// → PROMPTED("아직 보고 계세요?" 팝업) → 30초 무응답이면 확정, 반응하면 AWAKE로 리셋.
//
// 판정 타이머는 여기 JS가 소유한다(안드는 반대로 네이티브 포그라운드서비스가 세션 전체를 들고 있어
// 네이티브가 판정 주체 — 플랫폼 아키텍처 차이일 뿐 판정 로직은 동일). "사용자 입력"은 feed/index.tsx가
// 이미 idle 상한(IDLE_CAP_MINUTES)에 쓰던 실제 입력 지점(탭/스와이프/손짓/볼륨키)에서 이 훅이 반환하는
// markActivity()를 같이 호출해 공급한다.
//
// 보조신호(2단계 확정 조건, 4개 중 1개 이상이던 안드와 달리 3개): 눕혀짐(중력 Z)/충전 중/이어폰·블루투스
// 탈착. ⚠️ 안드의 "어둡다"(조도)는 iOS에 서드파티가 쓸 수 있는 공개 주변광 센서 API가 없어(private API만
// 존재, 심사 리스크) 포팅하지 않는다 — 나머지 신호로 충분히 커버(하나만 있어도 확정되는 구조이므로 개수가
// 하나 줄어도 기능이 죽지 않는다, Android의 "센서 없는 기기는 그 조건만 빠짐" 원칙과 동일).
type SleepModule = {
  start(): Promise<void>;
  stop(): void;
  /** 최근 관측된 중력 Z축(G, -1..1). 관찰 중 아니면 0. */
  gravityZ(): number;
  isCharging(): boolean;
  addListener(event: 'onAudioRouteLost', listener: () => void): { remove: () => void };
};

const DEFAULT_STILLNESS_MINUTES = 10; // 설정 미지정 시(안드 free 기본과 동일)
const SLEEP_CONFIRM_AFTER_MS = 5 * 60 * 1000; // 안드 SLEEP_CONFIRM_AFTER_MS 패리티
const SLEEP_PROMPT_TIMEOUT_MS = 30 * 1000; // 안드 SLEEP_PROMPT_TIMEOUT_MS 패리티
const SLEEP_WINDOW_START_HOUR = 22;
const SLEEP_WINDOW_END_HOUR = 9;
/**
 * 🔴 2026-09-02 사장님 제보("영상 보다 잠들었는데 수면감지가 안 끄더라" — 충전 중이었고 눕혀져
 *   있었고 이어폰도 안 꽂혀 있었다) — 보조신호는 두 개나 충족이었는데도 확정이 안 됐다.
 *   원인은 **밤 시간대(22~09) 게이트**다. 그 시각이 아니면 보조신호가 몇 개든 영원히 확정되지
 *   않는다.
 *
 *   안드로이드는 이 구멍을 2026-08-15에 이미 메웠다(SLEEP_NO_INPUT_ANYTIME_MS = 45분,
 *   PaceOverlayService.kt) — "낮에 켜두고 나가면 아무것도 안 끊는다"가 그 근거였다.
 *   그런데 **iOS엔 포팅되지 않았다.** 같은 값으로 맞춰 플랫폼 동작을 일치시킨다.
 *
 *   ⚠️ 과탐이 걱정되는 자리지만 문턱이 세 겹이라 그대로 유지된다: 무입력 45분 + 확정대기 5분 +
 *     팝업 30초 무응답. 깨어 있으면 그 사이 어느 지점에서든 화면을 만지게 되고, 그 순간
 *     markActivity()가 AWAKE로 되돌린다.
 */
const SLEEP_NO_INPUT_ANYTIME_MS = 45 * 60 * 1000;
// 안드 SLEEP_FLAT_GRAVITY_Z=7.5(m/s², 중력가속도 9.81 기준)를 iOS의 정규화된 중력 벡터(1G=1.0) 비율로 환산.
const SLEEP_FLAT_GRAVITY_RATIO = 7.5 / 9.81;
const TICK_MS = 10_000; // 30초 팝업 타임아웃을 너무 늦게 잡지 않을 정도의 해상도.

type Stage = 'awake' | 'suspect' | 'prompted';

// 2026-07-27 안드로이드 parity — 설정의 sleepStillnessMinutes(D8 프리미엄 조절 5~20분)를 SUSPECT 진입
// 임계값으로 쓴다. 2026-07-28 — "책상 vs 수면" 오탐 완화용 하한 15분은 새 설계에서도 유지(CONFIRM
// 단계가 밤시간대+보조신호까지 요구해 오탐 비용이 훨씬 낮아졌지만, 짧은 식사·잠깐 내려둠에서 SUSPECT
// 팝업이 뜨는 것 자체도 성가시므로 하한은 그대로 둔다).
export function useSleepGuard({ enabled, onSleep, stillnessMinutes }: { enabled: boolean; onSleep: (sleepOnsetAtMs?: number) => void; stillnessMinutes?: number }) {
  const [stage, setStage] = useState<Stage>('awake');
  const stageRef = useRef<Stage>('awake');
  const lastInputAtRef = useRef(0);
  const suspectSinceRef = useRef(0);
  const promptedAtRef = useRef(0);
  const audioLostRef = useRef(false);
  const modRef = useRef<SleepModule | null>(null);
  const onSleepRef = useRef(onSleep);
  onSleepRef.current = onSleep;

  const mins = Math.max(stillnessMinutes && stillnessMinutes > 0 ? stillnessMinutes : DEFAULT_STILLNESS_MINUTES, 15);

  const setStageBoth = (s: Stage) => { stageRef.current = s; setStage(s); };

  // Android markUserActivity()와 동일 — "사람이 방금 뭔가 했다"를 기록한다. 반드시 사람이 한 행동에서만
  // 부를 것(자동넘김·프로그램 스와이프는 절대 안 됨 — 안드 주석과 동일 이유: 자동넘김을 활동으로 세면
  // 자고 있어도 화면이 계속 바뀌어 판정이 영원히 안 난다).
  const markActivity = useCallback(() => {
    lastInputAtRef.current = Date.now();
    audioLostRef.current = false;
    if (stageRef.current !== 'awake') setStageBoth('awake');
  }, []);

  useEffect(() => {
    if (!enabled) { setStageBoth('awake'); return; }
    let mod: SleepModule | null = null;
    try {
      mod = requireNativeModule<SleepModule>('PaceSleep');
    } catch (e) {
      if (__DEV__) console.warn('[sleep] ❌ 네이티브 모듈 미링크 — Dev Client 재빌드 필요(취침감지 비활성):', String(e));
    }
    modRef.current = mod;
    lastInputAtRef.current = Date.now(); // 세션 시작 직후 기준점(안드 evaluateSleepStages와 동일)
    setStageBoth('awake');
    mod?.start().catch((err) => { if (__DEV__) console.warn('[sleep] start 실패:', String(err)); });
    const sub = mod?.addListener('onAudioRouteLost', () => { audioLostRef.current = true; });

    const id = setInterval(() => {
      const now = Date.now();
      const noInputMs = now - lastInputAtRef.current;
      const stillnessMs = mins * 60 * 1000;

      if (stageRef.current === 'awake') {
        if (noInputMs >= stillnessMs) {
          suspectSinceRef.current = now;
          setStageBoth('suspect');
          if (__DEV__) console.log('[sleep] stage=SUSPECT noInputMs=', noInputMs);
        }
        return;
      }

      if (stageRef.current === 'suspect') {
        if (now - suspectSinceRef.current < SLEEP_CONFIRM_AFTER_MS) return;
        const hour = new Date().getHours();
        const withinWindow = hour >= SLEEP_WINDOW_START_HOUR || hour < SLEEP_WINDOW_END_HOUR;
        const gz = modRef.current?.gravityZ?.() ?? 0;
        const laidFlat = Math.abs(gz) >= SLEEP_FLAT_GRAVITY_RATIO;
        const charging = modRef.current?.isCharging?.() ?? false;
        const supporting = laidFlat || charging || audioLostRef.current;
        // 안드로이드 evaluateSleepStages와 동일한 2경로 구조 — 둘 중 하나만 통과하면 확정한다.
        //   · 야간 경로: 밤 시간대 + 보조신호 1개 이상 (기존)
        //   · 상시 경로: 시간대·보조신호와 무관하게 무입력 45분 (위 SLEEP_NO_INPUT_ANYTIME_MS 주석)
        const nightPath = withinWindow && supporting;
        const anytimePath = noInputMs >= SLEEP_NO_INPUT_ANYTIME_MS;
        if (!nightPath && !anytimePath) {
          if (__DEV__) console.log('[sleep] confirm held — night=', nightPath, '(window=', withinWindow, 'flat=', laidFlat, 'gz=', gz, 'charging=', charging, 'btGone=', audioLostRef.current, ') anytime=', anytimePath, '(noInputMs=', noInputMs, ')');
          return;
        }
        if (__DEV__) console.log('[sleep] confirm passed via', nightPath ? 'night' : 'anytime', 'path (noInputMs=', noInputMs, ')');
        promptedAtRef.current = now;
        setStageBoth('prompted');
        if (__DEV__) console.log('[sleep] stage=PROMPTED — "아직 보고 계세요?"');
        return;
      }

      // prompted — 반응이 있었으면 markActivity()가 이미 awake로 되돌렸다. 여기까지 왔다는 건
      // 아직 무반응이라는 뜻이므로, 유예시간이 지나면 확정한다.
      if (now - promptedAtRef.current >= SLEEP_PROMPT_TIMEOUT_MS) {
        if (__DEV__) console.log('[sleep] 😴 CONFIRMED — no response');
        setStageBoth('awake');
        // ⭐ 잠든 "실제 시각" = 마지막 사용자 입력 시각(그 뒤 무입력 대기·확정 대기·팝업 무응답은 전부
        // 판정에 걸린 시간이지 시청한 시간이 아니다 — 안드 markExpired 주석과 동일 원칙).
        onSleepRef.current(lastInputAtRef.current);
      }
    }, TICK_MS);

    return () => {
      clearInterval(id);
      try { sub?.remove(); } catch {}
      try { mod?.stop(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mins]);

  return { markActivity, isSleepPrompted: stage === 'prompted' };
}
