// 손짓 통과(크로싱/dip) 판정 로직 합성 시나리오 테스트 — PaceGestureModule.swift의 판정부를
// 상수까지 그대로 미러링해 실기기 없이 로직 회귀를 잡는다. (사장님 "내가 테스터야?" — 설치 전 기계 검증)
// ⚠️ 원본과 로직이 갈라지면 무의미 — 원본 수정 시 이 파일도 같이 수정할 것.
import Foundation

// ── 원본 상수(2026-08-25 안드 세션 수정 반영) ──
let passRefractoryMs = 500.0
let crossWindowMs = 2500.0
let crossNeedMin = 0.07
let crossNeedMax = 0.10
let crossNeedK = 0.5
let crossMinSegSpeed = 0.40
let crossBigNetX = 0.30
let crossRearmReturnX = 0.08
let crossRearmAbsentMs = 600.0
let crossMinHandSize = 0.08
let dipWindowMs = 1200.0

struct Sim {
  var crossHistory: [(t: Double, x: Double)] = []
  var crossLastFireDir = 0.0
  var crossArmed = true
  var crossLastSampleT = 0.0
  var crossLastSampleX = 0.0
  var crossFireX = 0.0
  var dipHistory: [(t: Double, luma: Double, l: Double, m: Double, r: Double)] = []
  var brightRefAll = 0.0, brightRefL = 0.0, brightRefM = 0.0, brightRefR = 0.0
  var baseEmaL = -1.0, baseEmaM = -1.0, baseEmaR = -1.0
  var lastTriggerMs = -10000.0
  var events: [String] = []

  // 크로싱 판정 — processTrack의 해당 블록 미러
  mutating func feedHand(t: Double, x: Double, size: Double) {
    guard size >= crossMinHandSize else { return }
    if !crossArmed, (x - crossFireX >= crossRearmReturnX) || (t - crossLastSampleT >= crossRearmAbsentMs) {
      crossArmed = true
    }
    crossLastSampleT = t
    crossLastSampleX = x
    crossHistory.append((t, x))
    while let f = crossHistory.first, t - f.t > crossWindowMs { crossHistory.removeFirst() }
    guard crossHistory.count >= 2 else { return }
    let xs = crossHistory
    var segStart = xs.count - 1
    var dirSign = 0.0
    var i = xs.count - 1
    while i > 0 {
      let dx = xs[i].x - xs[i - 1].x
      if abs(dx) < 0.01 { i -= 1; segStart = i; continue }
      let s: Double = dx > 0 ? 1 : -1
      if dirSign == 0 { dirSign = s } else if s != dirSign { break }
      i -= 1
      segStart = i
    }
    let segNet = xs.last!.x - xs[segStart].x
    let segSteps = xs.count - 1 - segStart
    let segMs = xs.last!.t - xs[segStart].t
    let needRange = min(crossNeedMax, max(crossNeedMin, size * crossNeedK))
    let rangeOk = segSteps >= 2 ? abs(segNet) >= needRange : abs(segNet) >= needRange * 2
    let segSpeed = segMs > 0 ? abs(segNet) / (segMs / 1000) : .greatestFiniteMagnitude
    let speedOk = segSpeed >= crossMinSegSpeed || abs(segNet) >= crossBigNetX
    if rangeOk, speedOk, crossArmed || segNet > 0 {
      crossHistory.removeAll()
      if t - lastTriggerMs <= passRefractoryMs { events.append("crossdrop"); return }
      // 방향 무관 + 상대방향 복귀 무시(직전 발화 반대 방향, 2초 내).
      let dir: Double = segNet > 0 ? 1 : -1
      if dir == -crossLastFireDir && t - lastTriggerMs < 2000 { crossLastFireDir = 0; events.append("returndrop"); return }
      crossLastFireDir = dir
      crossArmed = false; crossFireX = x; lastTriggerMs = t; events.append("FIRE cross")
    }
  }

  // dip/lumapass 판정 — checkOcclusion의 해당 블록 미러
  mutating func feedLuma(t: Double, l: Double, m: Double, r: Double) {
    let luma = (l + m + r) / 3
    dipHistory.append((t, luma, l, m, r))
    while let f = dipHistory.first, t - f.t > dipWindowMs { dipHistory.removeFirst() }
    brightRefAll = max(luma, brightRefAll * 0.995)
    brightRefL = max(l, brightRefL * 0.995)
    brightRefM = max(m, brightRefM * 0.995)
    brightRefR = max(r, brightRefR * 0.995)
    baseEmaL = baseEmaL < 0 ? l : baseEmaL * 0.98 + l * 0.02
    baseEmaM = baseEmaM < 0 ? m : baseEmaM * 0.98 + m * 0.02
    baseEmaR = baseEmaR < 0 ? r : baseEmaR * 0.98 + r * 0.02
    // lumapass
    if t - lastTriggerMs > passRefractoryMs, dipHistory.count >= 6, let firstD = dipHistory.first, t - firstD.t >= 500 {
      func onset(_ vals: [(t: Double, v: Double)], _ ref: Double) -> (at: Double, dir: Double)? {
        guard ref > 40 else { return nil }
        if let e = vals.first(where: { abs($0.v - ref) >= ref * 0.15 }) { return (e.t, e.v > ref ? 1.0 : -1.0) }
        return nil
      }
      let oL = onset(dipHistory.map { (t: $0.t, v: $0.l) }, baseEmaL)
      let oM = onset(dipHistory.map { (t: $0.t, v: $0.m) }, baseEmaM)
      let oR = onset(dipHistory.map { (t: $0.t, v: $0.r) }, baseEmaR)
      if let eR = oR, let eM = oM, let eL = oL, eR.dir == eM.dir, eM.dir == eL.dir {
        let tR3 = eR.at, tM3 = eM.at, tL3 = eL.at
        if tR3 < tM3, tM3 < tL3, tL3 - tR3 >= 80, tL3 - tR3 <= 900 {
          dipHistory.removeAll(); lastTriggerMs = t; events.append("FIRE lumapass"); return
        }
        if tL3 < tM3, tM3 < tR3, tR3 - tL3 >= 80, tR3 - tL3 <= 900 {
          dipHistory.removeAll(); lastTriggerMs = t; events.append("FIRE lumapass"); return
        }
      }
    }
    // nearpass(깊은 dip)
    if t - lastTriggerMs > passRefractoryMs, dipHistory.count >= 5, let first = dipHistory.first, t - first.t >= 600 {
      let bright = max(dipHistory.map { $0.luma }.max() ?? 0, brightRefAll)
      if bright > 40 {
        let cands = dipHistory.filter { t - $0.t >= 80 && t - $0.t <= 800 }
        if let dip = cands.min(by: { $0.luma < $1.luma }),
           dip.luma <= bright * 0.5, luma >= brightRefAll * 0.7 {
          let onsetTh = brightRefAll * 0.55
          let tL = cands.first(where: { $0.l <= onsetTh })?.t ?? dip.t
          let tR = cands.first(where: { $0.r <= onsetTh })?.t ?? dip.t
          dipHistory.removeAll()
          lastTriggerMs = t; events.append("FIRE nearpass")
        }
      }
    }
  }
}

var pass = 0, fail = 0
func check(_ name: String, _ events: [String], fires: Int, expectContains: [String] = [], expectAbsent: [String] = []) {
  let f = events.filter { $0.hasPrefix("FIRE") }.count
  var ok = f == fires
  for e in expectContains where !events.contains(where: { $0.contains(e) }) { ok = false }
  for e in expectAbsent where events.contains(where: { $0.contains(e) }) { ok = false }
  print("\(ok ? "PASS" : "FAIL")  \(name)  fires=\(f)(기대 \(fires))  events=\(events)")
  if ok { pass += 1 } else { fail += 1 }
}

// ── 시나리오 ──
// 1. 띄엄띄엄 왼→오(사용자) = x 감소, 2회만 포착 (22:47 실패 케이스)
var s1 = Sim()
s1.feedHand(t: 0, x: 0.80, size: 0.12)
s1.feedHand(t: 300, x: 0.30, size: 0.12)
check("띄엄 왼→오 2포착", s1.events, fires: 1, expectContains: ["cross"])

// 2. 연속 스침+복귀 (22:52 전멸 케이스): 스침(감소)→복귀(증가)→스침→복귀→스침
var s2 = Sim()
var t2 = 0.0
for k in 0..<3 {
  s2.feedHand(t: t2, x: 0.85, size: 0.15); t2 += 150
  s2.feedHand(t: t2, x: 0.45, size: 0.15); t2 += 150
  s2.feedHand(t: t2, x: 0.15, size: 0.15); t2 += 300 // 스침 완료
  if k < 2 { s2.feedHand(t: t2, x: 0.55, size: 0.15); t2 += 150; s2.feedHand(t: t2, x: 0.85, size: 0.15); t2 += 400 } // 복귀
}
check("연속 3스침+복귀 2회", s2.events, fires: 3, expectAbsent: [])

// 3. 오→왼만 (차단): x 증가
var s3 = Sim()
s3.feedHand(t: 0, x: 0.15, size: 0.15)
s3.feedHand(t: 250, x: 0.60, size: 0.15)
s3.feedHand(t: 500, x: 0.90, size: 0.15)
check("오→왼 통과(방향 무관)", s3.events, fires: 1)

// 4. 느린 왼→오 (2초)
var s4 = Sim()
for (dt, x) in [(0.0, 0.85), (500.0, 0.70), (1000.0, 0.55), (1500.0, 0.40), (2000.0, 0.28)] {
  s4.feedHand(t: dt, x: x, size: 0.10)
}
check("느린 왼→오 2초", s4.events, fires: 1)

// 5. 불응 중 완성 스트로크 폐기 (23:00 "오왼에 바뀜" 케이스): 발화 직후 0.3s에 다음 스트로크 완성
var s5 = Sim()
s5.feedHand(t: 0, x: 0.80, size: 0.15)
s5.feedHand(t: 200, x: 0.30, size: 0.15) // FIRE
s5.feedHand(t: 350, x: 0.80, size: 0.15) // 복귀 시작(불응 중)
s5.feedHand(t: 450, x: 0.35, size: 0.15) // 불응 중 새 스트로크 완성 → crossdrop이어야 함
check("불응 중 스트로크 폐기", s5.events, fires: 1, expectContains: ["crossdrop"])

// 6. 빠른 2연속 스침(0.7s 간격) — 0.5s 불응이면 둘 다 발화해야
var s6 = Sim()
s6.feedHand(t: 0, x: 0.80, size: 0.15)
s6.feedHand(t: 200, x: 0.30, size: 0.15) // FIRE 1
s6.feedHand(t: 700, x: 0.82, size: 0.15) // 새 시작(불응 지남, 복귀로 인식될 수 있음 — 증가 스트로크는 0.38 초과 시 skip)
s6.feedHand(t: 900, x: 0.32, size: 0.15) // FIRE 2
check("빠른 2연속(0.7s)", s6.events, fires: 2)

// 7. lumapass 왼→오: 오른쪽→가운데→왼쪽 순서 얕은 dip
var s7 = Sim()
var t7 = 0.0
for _ in 0..<10 { s7.feedLuma(t: t7, l: 150, m: 150, r: 150); t7 += 80 } // 밝은 기준 형성
s7.feedLuma(t: t7, l: 150, m: 150, r: 110); t7 += 100
s7.feedLuma(t: t7, l: 150, m: 110, r: 120); t7 += 100
s7.feedLuma(t: t7, l: 110, m: 130, r: 150); t7 += 100
for _ in 0..<3 { s7.feedLuma(t: t7, l: 150, m: 150, r: 150); t7 += 80 }
check("lumapass 왼→오", s7.events, fires: 1, expectContains: ["lumapass"])

// 8. lumapass 역순(오→왼) 차단
var s8 = Sim()
var t8 = 0.0
for _ in 0..<10 { s8.feedLuma(t: t8, l: 150, m: 150, r: 150); t8 += 80 }
s8.feedLuma(t: t8, l: 110, m: 150, r: 150); t8 += 100
s8.feedLuma(t: t8, l: 130, m: 110, r: 150); t8 += 100
s8.feedLuma(t: t8, l: 150, m: 130, r: 110); t8 += 100
for _ in 0..<3 { s8.feedLuma(t: t8, l: 150, m: 150, r: 150); t8 += 80 }
check("lumapass 역순 통과(방향 무관)", s8.events, fires: 1)

// 9. 연속 근접 스침(기준 오염, 22:52): 깊은 dip 반복 — 감쇠 기준으로 2회 이상 발화해야
var s9 = Sim()
var t9 = 0.0
for _ in 0..<12 { s9.feedLuma(t: t9, l: 150, m: 150, r: 150); t9 += 80 }
for _ in 0..<2 {
  s9.feedLuma(t: t9, l: 150, m: 150, r: 60); t9 += 90
  s9.feedLuma(t: t9, l: 60, m: 55, r: 60); t9 += 90   // 깊은 가림
  s9.feedLuma(t: t9, l: 120, m: 130, r: 140); t9 += 90 // 회복
  for _ in 0..<8 { s9.feedLuma(t: t9, l: 145, m: 145, r: 145); t9 += 80 }
}
check("연속 근접 스침 2회", s9.events, fires: 2)

// 10. 어두운 방(전체 밝기 30) — 아무것도 발화하면 안 됨
var s10 = Sim()
var t10 = 0.0
for _ in 0..<20 { s10.feedLuma(t: t10, l: 30, m: 30, r: 30); t10 += 80 }
s10.feedLuma(t: t10, l: 10, m: 30, r: 30); t10 += 100
s10.feedLuma(t: t10, l: 30, m: 10, r: 30); t10 += 100
check("어두운 방 무발화", s10.events, fires: 0)

// 11. 영상 밝기 변화(전 구간 동시 하락) — 오탐 금지
var s11 = Sim()
var t11 = 0.0
for _ in 0..<10 { s11.feedLuma(t: t11, l: 150, m: 150, r: 150); t11 += 80 }
for _ in 0..<5 { s11.feedLuma(t: t11, l: 90, m: 90, r: 90); t11 += 80 } // 동시 하락(장면 전환)
for _ in 0..<5 { s11.feedLuma(t: t11, l: 150, m: 150, r: 150); t11 += 80 }
check("전 구간 동시 하락 무발화", s11.events, fires: 0)

// 12. 손목 플릭(23:02 실측): size 0.13, 이동 0.13 (화면 13%) — 크기 비례 문턱으로 발화해야
var s12 = Sim()
s12.feedHand(t: 0, x: 0.55, size: 0.13)
s12.feedHand(t: 150, x: 0.48, size: 0.13)
s12.feedHand(t: 300, x: 0.42, size: 0.13)
check("손목 플릭(중거리)", s12.events, fires: 1)

// 13. 미세 떨림(±0.02 진동) — 발화 금지
var s13 = Sim()
for (dt, x) in [(0.0, 0.50), (200.0, 0.47), (400.0, 0.49), (600.0, 0.46), (800.0, 0.48)] {
  s13.feedHand(t: dt, x: x, size: 0.13)
}
check("미세 떨림 무발화", s13.events, fires: 0)

// 14. 가까운 손(0.24) 플릭 — 기준 0.204, 실제 이동 0.30
var s14 = Sim()
s14.feedHand(t: 0, x: 0.75, size: 0.24)
s14.feedHand(t: 200, x: 0.45, size: 0.24)
check("가까운 플릭", s14.events, fires: 1)

// 15. 왼쪽 표류(정지 시청 중 손이 천천히 왼쪽으로 이동, 1.5s에 0.15) = 0.11/초.
//     이전엔 "알려진 한계: 1회 발화"로 적어뒀지만 그건 한계가 아니라 결함이었다 —
//     속도 게이트(0.20/초)로 차단된다. 무발화가 정답.
var s15 = Sim()
for (dt, x) in [(0.0, 0.60), (400.0, 0.56), (800.0, 0.52), (1200.0, 0.48), (1500.0, 0.44)] {
  s15.feedHand(t: dt, x: x, size: 0.13)
}
check("느린 왼쪽 표류 차단", s15.events, fires: 0)

// ── 17~23 (2026-08-25 안드 세션 추가): 사장님 "가까운 손 중간 손 다 인식 안 돼"를 재현·고정 ──
// ⚠️ 기존 14번("가까운 플릭")은 이동폭을 0.30으로 잡아 **문턱에 맞춰 쓴** 시나리오였다. 그래서
//    실기기가 전멸하는 동안에도 이 시뮬은 초록이었다. 시나리오는 문턱이 아니라 실측에서 나와야 한다.
//    아래 16·17은 사장님 실측 이동폭(0.12~0.13)을 쓴다.

// 17. 가까운 손(0.25) 실측 이동 0.13 — 구 문턱이 0.21을 요구해 원리적으로 미달이던 케이스
var s16 = Sim()
s16.feedHand(t: 0, x: 0.60, size: 0.25)
s16.feedHand(t: 120, x: 0.54, size: 0.25)
s16.feedHand(t: 240, x: 0.47, size: 0.25)
check("가까운 손 실측 이동0.13", s16.events, fires: 1)

// 18. 중간 손(0.135) 실측 이동 0.12 — 구 문턱 0.12와 동률이라 사실상 미달이던 케이스
var s17 = Sim()
s17.feedHand(t: 0, x: 0.58, size: 0.135)
s17.feedHand(t: 120, x: 0.52, size: 0.135)
s17.feedHand(t: 250, x: 0.46, size: 0.135)
check("중간 손 실측 이동0.12", s17.events, fires: 1)

// 19. 재무장 데드락: 긋고 → **손을 든 채 천천히** 되돌리고(프레임당 +0.015) → 다시 긋기.
//     구 재무장(직전 프레임 대비 +0.02)은 여기서 영영 안 풀려 크로싱이 세션 내내 죽었다.
var s18 = Sim()
s18.feedHand(t: 0, x: 0.80, size: 0.15)
s18.feedHand(t: 200, x: 0.30, size: 0.15)
var t18 = 400.0, x18 = 0.30
for _ in 0..<30 { x18 += 0.015; s18.feedHand(t: t18, x: x18, size: 0.15); t18 += 60 }
s18.feedHand(t: t18, x: 0.75, size: 0.15); t18 += 150
s18.feedHand(t: t18, x: 0.25, size: 0.15)
// 속도 문턱 0.40으로 느린 복귀 잔구간 발화도 소멸 — 원래 의도(2발화) 복원
check("느린 복귀 후 재발화(데드락)", s18.events, fires: 2)

// 20. 손을 완전히 내렸다가(900ms 공백) 다시 올려 긋기 — 소실 경로 재무장
var s19 = Sim()
s19.feedHand(t: 0, x: 0.80, size: 0.15)
s19.feedHand(t: 200, x: 0.30, size: 0.15)
s19.feedHand(t: 1100, x: 0.78, size: 0.15)
s19.feedHand(t: 1300, x: 0.28, size: 0.15)
check("손 내렸다 다시 긋기", s19.events, fires: 2)

// 21. 제자리 흔들림(진폭 0.09, 손폭 0.13) — 사장님 "가만히 있으면서 흔들리는 건 안 넘어가게"
var s20 = Sim()
var t20 = 0.0
for k in 0..<10 { s20.feedHand(t: t20, x: k % 2 == 0 ? 0.53 : 0.44, size: 0.13); t20 += 180 }
check("제자리 흔들림 무발화", s20.events, fires: 0)

// 22. 아주 느린 진짜 통과(0.45를 2.5초) — 속도 0.18/초로 게이트 미달이나 이동폭 0.30 이상이라 통과
var s21 = Sim()
for (dt, x) in [(0.0, 0.85), (600.0, 0.76), (1200.0, 0.66), (1800.0, 0.55), (2500.0, 0.40)] {
  s21.feedHand(t: dt, x: x, size: 0.15)
}
check("아주 느린 큰 통과", s21.events, fires: 1)

// 23. 턱 괸 손 미세 표류(1.2초에 0.06) — 무발화
var s22 = Sim()
for (dt, x) in [(0.0, 0.50), (300.0, 0.485), (600.0, 0.47), (900.0, 0.455), (1200.0, 0.44)] {
  s22.feedHand(t: dt, x: x, size: 0.13)
}
check("턱 괸 손 미세 표류 무발화", s22.events, fires: 0)

// 16. 두 트랙 교대(23:08 유령 스트로크) — 트랙별 분리 후에는 각 트랙이 정지 상태라 아무 일도 없어야.
//     (원본이 트랙별 crossHistory로 바뀌었으므로 시뮬에선 트랙=Sim 인스턴스로 모델링)
var s16a = Sim(), s16b = Sim()
var t16 = 0.0
for _ in 0..<15 {
  s16a.feedHand(t: t16, x: 0.30, size: 0.12); t16 += 50
  s16b.feedHand(t: t16, x: 0.52, size: 0.13); t16 += 50
}
check("두 트랙 교대 무발화(A)", s16a.events, fires: 0, expectAbsent: ["crossskip"])
check("두 트랙 교대 무발화(B)", s16b.events, fires: 0, expectAbsent: ["crossskip"])

// 25. 역방향 라치 자가복구 — F(발화) R(무시) F(발화) R(무시) F(발화): 정방향 전부 발화해야
var s25 = Sim()
var t25 = 0.0
for k in 0..<5 {
  let fwd = k % 2 == 0
  let x0 = fwd ? 0.85 : 0.15, x1 = fwd ? 0.15 : 0.85
  s25.feedHand(t: t25, x: x0, size: 0.15); t25 += 150
  s25.feedHand(t: t25, x: (x0+x1)/2, size: 0.15); t25 += 150
  s25.feedHand(t: t25, x: x1, size: 0.15); t25 += 700
}
check("역방향 라치 자가복구", s25.events, fires: 3, expectContains: ["returndrop"])

// 26. 밝아지는 통과(안드 0984254 이식 검증) — 어두운 배경(60) 위로 밝은 손(100)이 오→가→왼 순차
var s26 = Sim()
var t26 = 0.0
for _ in 0..<10 { s26.feedLuma(t: t26, l: 60, m: 60, r: 60); t26 += 80 }
s26.feedLuma(t: t26, l: 60, m: 60, r: 100); t26 += 100
s26.feedLuma(t: t26, l: 60, m: 100, r: 80); t26 += 100
s26.feedLuma(t: t26, l: 100, m: 70, r: 60); t26 += 100
for _ in 0..<3 { s26.feedLuma(t: t26, l: 60, m: 60, r: 60); t26 += 80 }
check("밝아지는 통과(lumapass)", s26.events, fires: 1, expectContains: ["lumapass"])

// 27. 방향 혼합(조명 잡음) — R 밝아지고 M 어두워짐: 발화 금지
var s27 = Sim()
var t27 = 0.0
for _ in 0..<10 { s27.feedLuma(t: t27, l: 100, m: 100, r: 100); t27 += 80 }
s27.feedLuma(t: t27, l: 100, m: 100, r: 130); t27 += 100
s27.feedLuma(t: t27, l: 100, m: 70, r: 120); t27 += 100
s27.feedLuma(t: t27, l: 130, m: 80, r: 100); t27 += 100
for _ in 0..<3 { s27.feedLuma(t: t27, l: 100, m: 100, r: 100); t27 += 80 }
check("방향 혼합 잡음 무발화", s27.events, fires: 0)

print("\n결과: PASS \(pass) / FAIL \(fail)")
exit(fail == 0 ? 0 : 1)
