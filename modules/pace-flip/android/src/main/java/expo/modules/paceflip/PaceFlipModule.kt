package expo.modules.paceflip

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import kotlin.math.sqrt

// Pace Android Flip Mode (스펙 §4-A, 2026-07-23). iOS PaceFlipModule.swift의 CMMotionManager
// gravity.z 방식을 Android SensorManager로 미러링해 "내려놓은 시간(쉬는 시간)"을 측정한다.
//
// ⚠️ 좌표계가 iOS와 부호가 반대다 — Android TYPE_GRAVITY는 "정지 상태에서 가속도계가 읽는 반작용력"
// 관례를 따른다: 화면이 위(테이블에 face-up)면 테이블이 기기를 위로 떠받치므로 z축(화면 밖으로
// 나가는 방향)이 위를 향해 z ≈ +9.8. 화면이 아래(엎어놓음)면 그 반작용력이 이제 z축의 반대 방향이라
// z ≈ -9.8. (iOS CMMotionManager의 gravity 필드는 "중력이 향하는 방향" 그 자체라 부호가 반대 —
// face-up이 음수, face-down이 양수. 두 플랫폼 다 물리적으로는 같은 현상을 반대 부호로 표현할 뿐.)
//
// ⚠️ 리서치 반영(2026-07-23, 오탐 완화) — 순수 gravity.z 임계값만 쓰면 차 대시보드에 눕혀둔 폰,
// 주머니 속, 비스듬한 거치대 등에서 오탐 위험이 있음(진동/코너링 힘이 기울기 변화처럼 보임) —
// 실제 드라이빙 감지/낙상 감지 SDK들이 쓰는 표준 완화책인 "선형가속도 크기가 거의 0"(=기기가
// 실제로 거의 안 움직이는 중) 게이트를 추가로 요구한다. TYPE_LINEAR_ACCELERATION(중력 성분이 이미
// 제거된 값)의 크기가 LINEAR_ACCEL_EPSILON 이하일 때만 "진짜로 내려놓은 상태 후보"로 인정 — 차량
// 진동/걷는 중 흔들림처럼 tilt는 맞아도 계속 움직이는 상황을 걸러낸다.
//
// ⚠️ 비정상 케이스 대응(맥 세션이 iOS에 먼저 추가한 background 브리징과 동일 계약 공유) — Android도
// 포그라운드 전용으로 의도적으로 통일했으므로(useFlipMode.ts 참고) 앱이 background로 가면 stop()이
// 불려 센서 관찰이 멈춘다. `physicalFaceDown()`이 디바운스 없는 즉시 판정을 제공해 JS가 foreground
// 복귀 시 "그 사이 집어들었는지" 재조율할 수 있게 한다 — kill 복구/방치 상한 등 나머지 비정상 케이스는
// useFlipStore.ts(스토어 레벨, 플랫폼 공용)가 전부 처리.
class PaceFlipModule : Module() {
  private var sensorManager: SensorManager? = null
  private var gravityListener: SensorEventListener? = null
  private var linearAccelListener: SensorEventListener? = null

  private var faceDown = false
  private var candidateSinceMs = -1L // 현재 확정 상태의 "반대"가 시작된 시각(-1=후보 없음)
  private var lastLinearAccelMagnitude = 0f
  private var lastZ: Float = 0f // 최신 gravity.z 샘플(즉시 물리상태 조회용, iOS PaceFlipModule.swift와 동일)
  private var hasSample = false // 첫 샘플 도착 여부(start 직후 stale 조회 방지)

  companion object {
    private const val FACE_DOWN_THRESHOLD = -7.85f // -0.8 * 9.80665 (SensorManager.STANDARD_GRAVITY)
    private const val FACE_UP_THRESHOLD = 4.90f     // +0.5 * 9.80665
    private const val DOWN_HOLD_MS = 2000L // 엎어놓기 확정까지 유지 시간(iOS와 동일)
    private const val UP_HOLD_MS = 1000L   // 집어들기 확정까지 유지 시간(iOS와 동일)
    // "거의 안 움직이는 중"으로 인정할 선형가속도 크기 상한(m/s²) — 순수 정지는 0에 가깝고, 걷기/
    // 차량 진동은 통상 1~9 m/s² 범위(리서치의 Sleep as Android 공개 자료 기준)라 그 아래로 넉넉히 잡음.
    private const val LINEAR_ACCEL_EPSILON = 1.2f
    // 배터리 절약 배칭 — 1~2초짜리 디바운스 창보다 훨씬 짧게 잡아야 반응성이 안 깨짐(리서치 권고).
    private const val MAX_REPORT_LATENCY_US = 200_000 // 200ms
  }

  override fun definition() = ModuleDefinition {
    Name("PaceFlip")
    Events("onFlip")

    // 디바운스 확정된 상태(관찰 중일 때만 유효).
    Function("isFaceDown") {
      faceDown
    }

    // 디바운스 없이 "지금 이 순간 물리적으로 엎어져 있나"를 최신 샘플로 즉시 판정.
    // background 복귀 후 재조율(그동안 집어들었는지)에 useFlipMode.ts가 사용. 아직 샘플 없으면 null
    // (iOS PaceFlipModule.swift의 physicalFaceDown()과 동일 계약 — 선형가속도 게이트는 여기선 적용
    // 안 함: 이건 디바운스 안전장치가 아니라 "지금 순간의 기울기 스냅샷"이 필요한 별개 용도라서).
    Function("physicalFaceDown") { ->
      if (!hasSample) null else lastZ < FACE_DOWN_THRESHOLD
    }

    AsyncFunction("start") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      val sm = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
      val gravitySensor = sm?.getDefaultSensor(Sensor.TYPE_GRAVITY)
      if (sm == null || gravitySensor == null) {
        promise.resolve(null) // 센서 없는 기기(에뮬레이터 등) — iOS의 isDeviceMotionAvailable 가드와 동일하게 조용히 스킵
        return@AsyncFunction
      }
      stopInternal() // 중복 start() 방지 — 재시작 시 이전 리스너 확실히 정리

      faceDown = false
      candidateSinceMs = -1L
      lastLinearAccelMagnitude = 0f
      hasSample = false
      sensorManager = sm

      val linearAccelSensor = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
      if (linearAccelSensor != null) {
        val laListener = object : SensorEventListener {
          override fun onSensorChanged(event: SensorEvent) {
            val (x, y, z) = Triple(event.values[0], event.values[1], event.values[2])
            lastLinearAccelMagnitude = sqrt(x * x + y * y + z * z)
          }
          override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
        }
        sm.registerListener(laListener, linearAccelSensor, SensorManager.SENSOR_DELAY_UI, MAX_REPORT_LATENCY_US)
        linearAccelListener = laListener
      }
      // 선형가속도 센서가 없는 기기(드묾)면 게이트 없이 gravity만으로 판단 — lastLinearAccelMagnitude가
      // 항상 0이라 자동으로 게이트를 항상 통과하게 되므로 별도 분기 불필요.

      val gListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
          val z = event.values[2]
          lastZ = z
          hasSample = true
          val now = SystemClock.elapsedRealtime()
          val tiltOpposite = if (faceDown) z > FACE_UP_THRESHOLD else z < FACE_DOWN_THRESHOLD
          val stillEnough = lastLinearAccelMagnitude <= LINEAR_ACCEL_EPSILON
          val oppositeNow = tiltOpposite && stillEnough
          val hold = if (faceDown) UP_HOLD_MS else DOWN_HOLD_MS
          if (oppositeNow) {
            if (candidateSinceMs < 0) {
              candidateSinceMs = now
            } else if (now - candidateSinceMs >= hold) {
              faceDown = !faceDown
              candidateSinceMs = -1L
              sendEvent("onFlip", mapOf("faceDown" to faceDown))
            }
          } else {
            candidateSinceMs = -1L // 후보 상태가 흔들리면(기울기 복귀 또는 움직임 재개) 리셋
          }
        }
        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
      }
      sm.registerListener(gListener, gravitySensor, SensorManager.SENSOR_DELAY_UI, MAX_REPORT_LATENCY_US)
      gravityListener = gListener

      promise.resolve(null)
    }

    Function("stop") {
      stopInternal()
    }
  }

  private fun stopInternal() {
    val sm = sensorManager ?: return
    gravityListener?.let { sm.unregisterListener(it) }
    linearAccelListener?.let { sm.unregisterListener(it) }
    gravityListener = null
    linearAccelListener = null
    sensorManager = null
    faceDown = false
    candidateSinceMs = -1L
    hasSample = false
  }
}
