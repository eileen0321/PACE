// 손짓 개인 보정 — 측정 표본을 모아 **개인 문턱**을 산출한다.
//
// 네이티브(PaceHandWaveDetector)는 "카메라 앞을 세 구간 순서대로 지나갔다"를 감지할 때
// 밝기가 기준 대비 얼마나 떨어졌는지(depth)를 함께 잰다. 보정 중에는 문턱을 1%로 활짝 열어
// **실제 깊이를 관측만** 하고 발화는 하지 않는다(GestureCalibrationSheet 주석 참고).
//
// 여기서 그 표본으로 문턱을 정한다.
import { Platform } from 'react-native';

export type CalibrationSample = { depth: number; spanMs: number; axis: string };

/** 몇 번 지나가게 할 것인가. 너무 많으면 이탈하고, 너무 적으면 한 번의 실수에 값이 휘둘린다. */
export const REQUIRED_SAMPLES = 5;

// 산출한 문턱이 벗어나면 안 되는 범위.
//   상한(0.97) — 기존 기본값. 이보다 민감해지면 보정하지 않은 것만 못하다.
//   하한(0.55) — 45% 하락을 요구하는 값. 이보다 둔하면 정상적인 손짓도 거의 안 잡힌다.
// 표본이 이상하게 나와도(조명 급변 등) 사용자를 못 쓰는 상태로 밀어넣지 않기 위한 안전대다.
const MAX_DIP_RATIO = 0.97;

/** 잡음 바닥을 재는 시간. 이 동안 사용자는 가만히 있는다. */
export const NOISE_PHASE_MS = 3000;

/**
 * 손짓으로 인정하려면 잡음 바닥의 몇 배여야 하는가.
 * 🔴 2026-08-29 실측 — 가만히 있어도 깊이 1.0~3.4% 표본이 초당 수 개씩 나온다. 그래서 예전
 *   구현은 사용자가 손을 들기도 전에 5개가 다 차버렸다(실측: 1.8초 만에 완료, 산출값은
 *   상한에 걸려 기존값과 동일 = 보정한 의미가 없음). 잡음보다 확실히 깊은 것만 센다.
 */
// 🔴 2026-08-30 실측 반영 — 2.0 은 너무 엄격했다. 잡음 상한 3.4% × 2 = 6.8% 인데 사장님의
//   실제 손짓이 5~6% 라 **진짜 손짓이 표본으로 인정되지 않는다.** 1.4 면 4.8% 라 그 사이에 든다.
const GESTURE_OVER_NOISE = 1.4;

/** 연속된 표본을 한 번의 손짓으로 묶는 간격. 잡음 3개를 3회로 세지 않기 위한 것. */
const MIN_GAP_MS = 700;
const MIN_DIP_RATIO = 0.55;

/**
 * 관측된 손짓 깊이의 **몇 %를 요구할 것인가.**
 * 1.0으로 두면 본인이 가장 얕게 한 손짓과 똑같은 깊이를 매번 내야 해서 자주 놓친다.
 * 0.6이면 "평소보다 좀 성의 없게 해도 잡히되, 몸을 기울이는 정도로는 안 걸리는" 지점이다.
 * ⚠️ 이 값은 아직 실기기로 검증되지 않았다 — 보정 후 실사용 성공률을 보고 조정해야 한다.
 */
const REQUIRE_FRACTION = 0.6;

function nativeModule(): any | null {
  if (Platform.OS !== 'android') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PaceOverlay } = require('../../modules/pace-overlay');
    return PaceOverlay ?? null;
  } catch {
    return null;
  }
}

/**
 * 표본에서 개인 문턱을 낸다.
 *
 * 최솟값이 아니라 **하위 30% 지점**을 쓴다 — 최솟값은 한 번의 어설픈 통과에 통째로 끌려간다.
 * 반대로 중앙값을 쓰면 평균보다 얕은 손짓이 매번 무시된다. 그 사이를 잡는다.
 */
/** 잡음 구간 표본에서 바닥(최댓값)을 낸다. */
export function noiseFloor(samples: CalibrationSample[]): number {
  const d = samples.map((s) => s.depth).filter((x) => Number.isFinite(x) && x > 0);
  return d.length ? Math.max(...d) : 0;
}

/** 이 표본이 손짓으로 셀 만큼 깊은가. */
export function isGestureDepth(depth: number, floor: number): boolean {
  return depth > Math.max(floor * GESTURE_OVER_NOISE, 0.02);
}

/**
 * 손짓 표본 + 잡음 바닥에서 개인 문턱을 낸다.
 *
 * 문턱은 **잡음 바닥과 손짓 깊이 사이**에 놓는다. 둘이 겹치면(손짓이 잡음만큼 얕으면)
 * 이 축으로는 가를 수 없다는 뜻이라 null 을 돌려준다 — 그때는 보정하지 않는 편이 낫다.
 */
export function deriveDipRatio(gestures: CalibrationSample[], floor: number): number | null {
  const depths = gestures.map((s) => s.depth).filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b);
  if (depths.length < 3) return null;
  // 가장 얕은 손짓도 잡히도록 하위 30% 지점을 쓴다(최솟값은 한 번의 실수에 끌려간다).
  const weakest = depths[Math.max(0, Math.floor(depths.length * 0.3) - 1)];
  if (weakest <= floor) return null; // 겹친다 = 이 축으로 못 가른다
  // 잡음 바닥과 가장 얕은 손짓의 사이(기하평균)를 문턱으로 삼는다.
  const required = Math.sqrt(Math.max(floor, 1e-4) * weakest);
  const ratio = 1 - required;
  return Math.min(MAX_DIP_RATIO, Math.max(MIN_DIP_RATIO, ratio));
}

let subscription: { remove: () => void } | null = null;

/**
 * 측정을 시작한다. 통과가 관측될 때마다 onSample 이 불린다.
 * @returns 카메라 권한이 없거나 Android 가 아니면 false
 */
export async function startCalibration(onSample: (s: CalibrationSample) => void): Promise<boolean> {
  const mod = nativeModule();
  if (!mod?.startGestureCalibration) return false;
  subscription?.remove();
  // ⚠️ Expo Modules 의 sendEvent 는 **모듈 객체의 addListener** 로 받는다. RN 의
  //   NativeEventEmitter 로 구독하면 리스너가 아예 안 붙어 표본이 JS 에 도달하지 않는다
  //   (2026-08-29 실기기에서 그렇게 샜다 — 네이티브 로그엔 표본 12개가 찍혔는데 저장이 안 됐다).
  //   이 저장소의 onFeedMediaCommand 가 쓰는 방식과 같게 맞춘다.
  try {
    subscription = mod.addListener('onGestureCalibrationSample', (e: CalibrationSample) => {
      if (e && Number.isFinite(e.depth)) onSample(e);
    });
  } catch {
    subscription = null;
  }
  try {
    return (await mod.startGestureCalibration()) !== false;
  } catch {
    return false;
  }
}

/**
 * 측정을 끝낸다. samples 를 주면 문턱을 산출해 저장한다.
 * 표본이 모자라거나 값이 이상하면 **저장하지 않는다** — 미보정 상태로 두는 편이 낫다.
 */
export async function stopCalibration(gestures?: CalibrationSample[], floor = 0): Promise<number | null> {
  const mod = nativeModule();
  subscription?.remove();
  subscription = null;
  let saved: number | null = null;
  if (gestures && gestures.length) {
    const ratio = deriveDipRatio(gestures, floor);
    // 상한에 걸린 값은 기본값과 같아 저장할 이유가 없다 — 저장하면 다시 보정할 기회를 잃는다.
    if (ratio != null && isCalibrated(ratio) && mod?.saveGestureCalibration) {
      try {
        await mod.saveGestureCalibration(ratio);
        saved = ratio;
      } catch {
        /* 저장 실패 — 미보정으로 남는다(기본값 동작) */
      }
    }
  }
  try {
    await mod?.stopGestureCalibration?.();
  } catch {
    /* 이미 꺼져 있을 수 있다 */
  }
  return saved;
}

/**
 * 저장된 값이 **실제로 보정된 것인가.**
 *
 * 🔴 2026-08-29 — 값이 있기만 하면 보정된 것으로 봤더니, 잡음으로 산출돼 상한(0.97)에 걸린
 *   값이 저장되고는 "이미 보정됨"으로 처리돼 **보정 화면이 다시 뜨지 않았다.** 기본값과
 *   똑같은 값은 보정이 아니다 — 그 경우 미보정으로 보고 다시 묻는다.
 */
export function isCalibrated(v: number): boolean {
  return v > 0 && v < MAX_DIP_RATIO;
}

/** 저장된 개인값(미보정이면 0). 설정에서 "보정됨/미보정"을 보여주는 데 쓴다. */
export async function getSavedCalibration(): Promise<number> {
  const mod = nativeModule();
  try {
    return (await mod?.getGestureCalibration?.()) ?? 0;
  } catch {
    return 0;
  }
}
