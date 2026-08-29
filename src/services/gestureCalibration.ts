// 손짓 개인 보정 — 측정 표본을 모아 **개인 문턱**을 산출한다.
//
// 네이티브(PaceHandWaveDetector)는 "카메라 앞을 세 구간 순서대로 지나갔다"를 감지할 때
// 밝기가 기준 대비 얼마나 떨어졌는지(depth)를 함께 잰다. 보정 중에는 문턱을 1%로 활짝 열어
// **실제 깊이를 관측만** 하고 발화는 하지 않는다(GestureCalibrationSheet 주석 참고).
//
// 여기서 그 표본으로 문턱을 정한다.
import { NativeEventEmitter, Platform } from 'react-native';

export type CalibrationSample = { depth: number; spanMs: number; axis: string };

/** 몇 번 지나가게 할 것인가. 너무 많으면 이탈하고, 너무 적으면 한 번의 실수에 값이 휘둘린다. */
export const REQUIRED_SAMPLES = 5;

// 산출한 문턱이 벗어나면 안 되는 범위.
//   상한(0.97) — 기존 기본값. 이보다 민감해지면 보정하지 않은 것만 못하다.
//   하한(0.55) — 45% 하락을 요구하는 값. 이보다 둔하면 정상적인 손짓도 거의 안 잡힌다.
// 표본이 이상하게 나와도(조명 급변 등) 사용자를 못 쓰는 상태로 밀어넣지 않기 위한 안전대다.
const MAX_DIP_RATIO = 0.97;
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
export function deriveDipRatio(samples: CalibrationSample[]): number | null {
  const depths = samples.map((s) => s.depth).filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b);
  if (depths.length < 3) return null;
  const idx = Math.max(0, Math.floor(depths.length * 0.3) - 1);
  const base = depths[idx];
  const required = base * REQUIRE_FRACTION;
  // 네이티브는 "1 - dipRatio" 를 필요 하락폭으로 쓴다(0.97 → 3% 하락 요구).
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
  try {
    const emitter = new NativeEventEmitter(mod);
    subscription = emitter.addListener('onGestureCalibrationSample', (e: CalibrationSample) => {
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
export async function stopCalibration(samples?: CalibrationSample[]): Promise<number | null> {
  const mod = nativeModule();
  subscription?.remove();
  subscription = null;
  let saved: number | null = null;
  if (samples && samples.length) {
    const ratio = deriveDipRatio(samples);
    if (ratio != null && mod?.saveGestureCalibration) {
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

/** 저장된 개인값(미보정이면 0). 설정에서 "보정됨/미보정"을 보여주는 데 쓴다. */
export async function getSavedCalibration(): Promise<number> {
  const mod = nativeModule();
  try {
    return (await mod?.getGestureCalibration?.()) ?? 0;
  } catch {
    return 0;
  }
}
