// 격자 축 "지속 환경 모션" 억제 검증 — 차 안 오발화(2026-09-04) 수정의 근거.
//
// 사장님 제보와 맥의 실기기 채증(diag 23:11~23:12 차 안): 손짓 없이 gridpass 20+회 연속 발화.
// 차가 움직이며 햇빛·그늘·풍경이 프레임 전체를 균일하게 바꿔 격자가 "손 스윕"으로 오판한다.
// 맥은 iOS(0590def)에, 나는 안드(PaceHandWaveDetector.checkGrossMotion)에 같은 억제를 넣었다.
//
// 이 스크립트가 답해야 하는 질문은 **두 개**다. 하나만 보면 안 된다:
//   ① 차량 모션이 실제로 억제되는가            (억제가 걸려야 한다)
//   ② 진짜 손짓은 그대로 통과하는가            (억제되면 기능이 죽는다)
// 문턱을 조이면 ①은 쉽게 만족되지만 ②가 죽는다 — 이 저장소가 여러 번 반복한 실패다.
//
// ⚠️ 이 시뮬은 Kotlin 을 실행하지 않는다. checkGrossMotion 의 계산을 JS 로 옮겨 적은 것이라
//    "로직이 의도대로 가르는가"만 답한다. 실제 카메라·조명·손 크기는 답하지 못한다.
//    (같은 한계가 wave_falsepositive.js 등 기존 시뮬에도 그대로 있다.)
//
// 실행: node scripts/wave_sustained_motion.js

const N = 16;                    // 16x16 격자 (GROSS_MOTION 격자와 동일)
const DELTA = 30;                // 칸이 "변했다"고 보는 밝기 차
const LAG = 180;                 // GROSS_MOTION_LAG_MS
const FPS = 30;

// PaceHandWaveDetector.kt 현재값
const FRAC_MIN = 0.05;           // GROSS_MOTION_CELL_FRACTION
const FRAC_MAX = 0.30;           // GROSS_MOTION_CELL_FRACTION_MAX
const DENS_MIN = 0.15;           // GROSS_MOTION_MIN_DENSITY_BIG
const ASPECT_MAX = 0.9;          // GROSS_MOTION_MAX_ASPECT

// 이번에 넣은 억제(iOS 0590def 와 동일 값)
const WINDOW_MS = 2500;          // GROSS_ACTIVITY_WINDOW_MS
const MIN_SAMPLES = 12;          // GROSS_ACTIVITY_MIN_SAMPLES
const SUSTAINED_RATIO = 0.45;    // GROSS_SUSTAINED_RATIO

const noise = (b, a = 2) =>
  new Array(N * N).fill(0).map(() => Math.round(b + (Math.random() * 2 - 1) * a));

function run(name, gen, frames = 150, suppressOn = true) {
  const hist = [];
  const activity = [];           // [t, 큰변화였나] — 발화·불응과 무관하게 매 프레임
  let fired = 0, suppressed = 0, firstFire = null;

  for (let f = 0; f < frames; f++) {
    const t = f * (1000 / FPS);
    const g = gen(f, t);
    hist.push([t, g]);
    while (hist.length && t - hist[0][0] > 700) hist.shift();
    const ref = [...hist].reverse().find((x) => t - x[0] >= LAG);
    if (!ref) continue;

    let ch = 0, mnx = 99, mxx = -1, mny = 99, mxy = -1;
    for (let i = 0; i < g.length; i++) {
      if (Math.abs(g[i] - ref[1][i]) >= DELTA) {
        ch++;
        const gy = (i / N) | 0, gx = i % N;
        if (gx < mnx) mnx = gx; if (gx > mxx) mxx = gx;
        if (gy < mny) mny = gy; if (gy > mxy) mxy = gy;
      }
    }
    const frac = ch / g.length;

    // ── 억제 판정 ──
    // ⚠️ 기록은 **변화가 0인 프레임도 포함해 매 프레임** 해야 한다. 조용한 프레임은
    //   "지속 모션이 아니다"라는 증거이기 때문이다. 이걸 `ch === 0` 조기반환 뒤에 두면
    //   조용한 방에서는 창이 영영 안 차고, 그 상태에서 아래 "창 미충족 = 보류" 규칙을
    //   적용하면 **손짓이 통째로 죽는다**(첫 시뮬에서 확인).
    activity.push([t, frac >= FRAC_MIN]);
    while (activity.length && t - activity[0][0] > WINDOW_MS) activity.shift();
    const active = activity.filter((a) => a[1]).length;
    // 창이 덜 찼으면 "판단 불가" — 발화하지 않는다(옵션 A).
    // 근거: 차량 모션 시작 직후 창이 차기 전 0.4초가 무방비로 새던 것을 막는다(억제 후에도
    // 14회 발화, 전부 창=1/1). 오탐(안 원하는데 넘어감)이 미탐(한 번 더 흔들면 됨)보다
    // 훨씬 나쁘다 — 이 파일의 다른 판정들과 같은 원칙이다.
    const windowReady = activity.length >= MIN_SAMPLES;
    const sustained = !windowReady || active / activity.length >= SUSTAINED_RATIO;

    if (ch === 0) continue;

    const bw = mxx - mnx + 1, bh = mxy - mny + 1;
    const dens = ch / (bw * bh);
    const aspect = bw / bh;
    const ok = frac >= FRAC_MIN && frac <= FRAC_MAX && dens >= DENS_MIN && aspect <= ASPECT_MAX;

    if (!ok) continue;
    if (suppressOn && sustained) { suppressed++; continue; }
    fired++;
    if (!firstFire) firstFire = { ch, frac, dens, aspect, active, win: activity.length };
  }

  const verdict = fired ? `발화 ${fired}회` : '무발화';
  const sup = suppressed ? `  억제 ${suppressed}회` : '';
  const d = firstFire
    ? `  (칸=${firstFire.ch} 비율=${firstFire.frac.toFixed(3)} 밀도=${firstFire.dens.toFixed(2)} 가로세로=${firstFire.aspect.toFixed(2)} 창=${firstFire.active}/${firstFire.win})`
    : '';
  console.log(`${verdict.padEnd(10)}${sup.padEnd(12)} ${name}${d}`);
  return { fired, suppressed };
}

console.log('── 억제되어야 하는 것(차량·지속 환경 모션) ──');
// ⚠️ 기존 wave_falsepositive.js 의 "차창 밖 풍경 흐름" 은 화면 전체가 변해 비율 0.559 로
//    상한(0.30)에 걸려 **애초에 발화하지 않는다** — 그걸로는 이 수정을 검증할 수 없다.
//    맥의 실기기 채증(차 안 gridpass 20+회)을 재현하려면 손 스윕과 기하학적으로 닮은
//    "세로 띠가 훑고 지나가는" 패턴이어야 한다(창틀·가로수 그늘이 그렇게 보인다).
const shadeBand = (speed, half, dark) => (f) => {
  const g = noise(145, 6);
  const px = (f * speed) % (N + 6) - 3;
  for (let i = 0; i < N * N; i++) {
    const gx = i % N, gy = (i / N) | 0;
    if (Math.abs(gx - px) < half && gy > 2 && gy < N - 2) g[i] = Math.round(g[i] * dark);
  }
  return g;
};
const cars = [
  ['그늘 띠가 세로로 훑음(주행)', shadeBand(0.9, 1.8, 0.5)],
  ['창틀 그림자 세로띠(좁게)', shadeBand(1.3, 1.5, 0.45)],
  ['가로수 그늘 빠르게 교차', shadeBand(2.1, 1.6, 0.5)],
];
let carBefore = 0, carAfter = 0, carSup = 0;
for (const [nm, gen] of cars) {
  const off = run(nm + ' [억제 없음]', gen, 150, false);
  const on = run(nm + ' [억제 적용]', gen, 150, true);
  carBefore += off.fired; carAfter += on.fired; carSup += on.suppressed;
}

console.log('');
console.log('── 통과해야 하는 것(진짜 손짓) ──');
// 손이 왼→오로 한 번 스쳐 지나감: 약 0.4초(12프레임) 동안만 화면 일부를 가린다
const wave = (startF) => (f) => {
  const g = noise(140, 6);
  const rel = f - startF;
  if (rel < 0 || rel >= 12) return g;
  const cx = (rel / 12) * (N + 4) - 2;      // 화면 밖 → 밖
  for (let i = 0; i < N * N; i++) {
    const gx = i % N, gy = (i / N) | 0;
    if (Math.abs(gx - cx) < 2.2 && gy > 3 && gy < N - 3) g[i] = Math.round(g[i] * 0.55);
  }
  return g;
};
const r4 = run('정지 배경에서 손짓 1회', wave(60));
// 실사용에 가까운 조합: 조용한 배경 + 손짓 2회
const r5 = run('정지 배경에서 손짓 2회', (f) => (f < 90 ? wave(40)(f) : wave(100)(f)));

console.log('');
const carOk = carBefore > 0 && carAfter === 0;
const waveOk = r4.fired > 0 && r5.fired > 0;
console.log(
  '① 차량 오발화 재현→억제: ' + (carOk ? '통과' : '실패') +
  ' (억제 없음 ' + carBefore + '회 발화 → 억제 적용 ' + carAfter + '회, 억제 ' + carSup + '회)'
);
console.log(
  '② 진짜 손짓 통과       : ' + (waveOk ? '통과' : '실패') +
  ' (손짓1회 ' + r4.fired + '발화 / 손짓2회 ' + r5.fired + '발화)'
);
// 재현이 안 되면 이 검증은 성립하지 않는다 — "억제 후 0회"는 원래 0회였다는 뜻일 수 있다.
if (!carBefore) {
  console.log('   ⚠️ 억제 없음에서도 발화가 0이면 시나리오가 실패를 재현하지 못한 것이다.');
}
console.log(carOk && waveOk ? '\n결과: 두 조건 모두 만족' : '\n결과: 미달');
process.exit(carOk && waveOk ? 0 : 1);
