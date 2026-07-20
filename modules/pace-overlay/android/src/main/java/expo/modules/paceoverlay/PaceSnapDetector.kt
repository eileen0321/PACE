package expo.modules.paceoverlay

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import androidx.core.content.ContextCompat
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sqrt

// 2026-07-20 핑거스냅 Hands-Free Next(사용자 지시, Focus Session 설계 — PACE_ARCHITECTURE.md 참고).
// 웹 검색으로 확인: 안드로이드는 서드파티 앱에 진짜 저전력 상시대기 하드웨어 경로(SoundTrigger/
// AlwaysOnHotwordDetector)를 안 열어준다 — 시스템 어시스턴트 역할(VoiceInteractionService)만
// 가능. 그래서 "0에 가까운 전력으로 항상 듣기"는 Pace 같은 일반 앱에 애초에 불가능한 옵션이다.
// 대신 이 detector는 (a) 앱 시작부터가 아니라 Focus Session이 켜져 있는 동안에만 호출되고,
// (b) FFT 없이 싸구려 2-bin Goertzel + 에너지 스파이크 휴리스틱만 써서 CPU 부담을 최소화한다.
// ⚠️ V1 — 실기기 튜닝 전. 오탐/미탐 비율은 아직 실사용 검증 안 됨(임계값은 초기 추정치).
object PaceSnapDetector {
  private const val TAG = "PaceSnapDetector"
  private const val SAMPLE_RATE = 16_000
  private const val FRAME_SIZE = 320 // 20ms @ 16kHz
  private const val REFRACTORY_MS = 450L
  // 스냅은 저역(목소리/쿵 소리)보다 중고역 비중이 뚜렷이 커서 이 비율로 걸러낸다(정밀 분류 아님, 1차 필터).
  private const val HIGH_BAND_HZ = 2500.0
  private const val LOW_BAND_HZ = 500.0

  @Volatile private var running = false
  private var thread: Thread? = null

  fun hasPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  fun start(context: Context, onSnap: () -> Unit) {
    if (running) return
    if (!hasPermission(context)) {
      Log.w(TAG, "RECORD_AUDIO not granted — not starting")
      return
    }
    running = true
    thread = Thread { runDetectionLoop(onSnap) }.apply { start() }
  }

  fun stop() {
    running = false
    thread = null
  }

  fun isRunning(): Boolean = running

  private fun goertzelMagnitude(samples: ShortArray, targetHz: Double, sampleRate: Int): Double {
    val n = samples.size
    val k = (0.5 + (n * targetHz) / sampleRate).toInt()
    val w = (2.0 * Math.PI / n) * k
    val coeff = 2.0 * cos(w)
    var q1 = 0.0
    var q2 = 0.0
    for (sample in samples) {
      val q0 = coeff * q1 - q2 + sample.toDouble()
      q2 = q1
      q1 = q0
    }
    return sqrt(q1 * q1 + q2 * q2 - q1 * q2 * coeff)
  }

  private fun runDetectionLoop(onSnap: () -> Unit) {
    val minBufferSize = AudioRecord.getMinBufferSize(
      SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
    )
    if (minBufferSize <= 0) {
      Log.e(TAG, "getMinBufferSize failed — aborting")
      running = false
      return
    }
    val bufferSize = max(minBufferSize, FRAME_SIZE * 4)
    val recorder = try {
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferSize
      )
    } catch (e: SecurityException) {
      Log.e(TAG, "AudioRecord init failed (permission?)", e)
      running = false
      return
    }

    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      Log.e(TAG, "AudioRecord not initialized")
      running = false
      recorder.release()
      return
    }

    val frame = ShortArray(FRAME_SIZE)
    var noiseFloor = 200.0 // 초기 추정치 — 조용한 프레임들로 서서히 적응
    var lastTriggerAt = 0L

    try {
      recorder.startRecording()
      while (running) {
        val read = recorder.read(frame, 0, FRAME_SIZE)
        if (read <= 0) continue

        var sumSquares = 0.0
        for (i in 0 until read) {
          val s = frame[i].toDouble()
          sumSquares += s * s
        }
        val rms = sqrt(sumSquares / read)

        val now = System.currentTimeMillis()
        val isSpike = rms > noiseFloor * 6.0 && rms > 800.0
        val pastRefractory = now - lastTriggerAt > REFRACTORY_MS

        if (isSpike && pastRefractory) {
          val highMag = goertzelMagnitude(frame, HIGH_BAND_HZ, SAMPLE_RATE)
          val lowMag = goertzelMagnitude(frame, LOW_BAND_HZ, SAMPLE_RATE)
          if (highMag > lowMag * 1.2) {
            lastTriggerAt = now
            onSnap()
          }
        } else if (rms < noiseFloor * 3.0) {
          // 조용한 프레임일 때만 바닥을 천천히 갱신 — 스파이크 자체가 바닥을 오염시키지 않게.
          noiseFloor = noiseFloor * 0.95 + rms * 0.05
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "detection loop error", e)
    } finally {
      try { recorder.stop() } catch (_: Exception) {}
      recorder.release()
    }
  }
}
