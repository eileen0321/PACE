package expo.modules.paceoverlay

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
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
  // 2026-07-26 사용자 지시(수면감지 V2 — 실제 수면앱들의 SONAR 방식, SonarBeat 논문 등 웹 리서치
  // 근거) 대응으로 44.1kHz로 상향(기존 16kHz) — 18~19kHz 반사음을 캡처하려면 나이퀴스트가 최소
  // 38kHz는 넘어야 한다. 스냅 탐지 로직 자체는 대역/ZCR을 표본율 파라미터로 계산하므로(goertzelMagnitude
  // 의 sampleRate 인자, zeroCrossingRate는 표본율 무관) 상향해도 그대로 작동 — 오히려 해상도가 올라감.
  // 별도 AudioRecord를 하나 더 열면(안드로이드 다수 기기가 동시 활성 AudioRecord 1개만 지원) 스냅
  // 감지와 충돌하므로, 이미 열려있는 이 스트림 하나를 공유해 스냅탐지 + sonar 반사음 분석을 같이 한다.
  private const val SAMPLE_RATE = 44_100
  private const val FRAME_SIZE = 882 // 20ms @ 44.1kHz
  private const val REFRACTORY_MS = 450L
  // 스냅은 저역(목소리/쿵 소리)보다 중고역 비중이 뚜렷이 커서 이 비율로 걸러낸다(정밀 분류 아님, 1차 필터).
  private const val HIGH_BAND_HZ = 2500.0
  private const val LOW_BAND_HZ = 500.0
  // 2026-07-21 밤 웹 리서치 근거 — 목소리(유성음)의 전형적 ZCR은 낮고(대략 0.02~0.10), 스냅/박수 같은
  // 임펄스성 브로드밴드 소음은 뚜렷이 높다. "미탐이 오탐보다 훨씬 큰 문제"라는 기존 원칙(코멘트 참고)에
  // 따라 보수적으로(낮게) 잡아 진짜 스냅을 걸러내는 부작용을 최소화 — 실기기 로그(SPIKE 라인의 zcr=)로
  // 실측 후 필요하면 올릴 것.
  private const val MIN_ZCR = 0.08

  // 2026-07-26 SONAR 안전망(수면감지 V2, 사용자 지시로 웹 리서치 후 구현 — SonarBeat/Sleep as Android
  // 방식 참고: 18~20kHz 초음파를 스피커로 내보내고 반사음 위상 변화로 흉부 움직임/호흡을 감지).
  // ⚠️ V1 — 아직 수면판단 결정에 반영 안 함(로그만). 실기기 실측 데이터 없이 위상→호흡률 임계값을
  // 확정하는 건 위험하다는 판단(핑거스냅/손짓도 실기기 로그로 여러 번 재조정한 뒤에야 쓸만해졌음) —
  // 같은 방식으로 먼저 로그를 쌓고, 그 데이터로 다음에 실제 게이팅 로직을 튜닝한다.
  private const val SONAR_TONE_HZ = 19_000.0
  private const val SONAR_HEARTBEAT_MS = 2000L

  @Volatile private var running = false
  private var thread: Thread? = null
  private var sonarTrack: AudioTrack? = null
  // (timestamp, phase) 최근 이력 — 위상 변화율(=반사체 움직임 속도의 대리 지표)을 보려면 최소 2점만
  // 있으면 되지만, 호흡 같은 주기적 패턴 여부를 보려면 몇 초 분량은 있어야 해서 여유 있게 담아둔다.
  private val sonarPhaseHistory = ArrayDeque<Pair<Long, Double>>()
  private const val SONAR_PHASE_WINDOW_MS = 8_000L

  // 2026-07-26 SONAR 톤 발생 — STREAM_MUSIC이 아니라 USAGE_MEDIA로 짧게 잡아 다른 앱(YouTube)
  // 오디오와 믹싱만 되고 포커스를 뺏지 않게 한다. 볼륨은 최소치 근처로(사람 귀엔 어차피 안 들리는
  // 대역이라 크게 낼 필요 없고, 스피커 왜곡/배터리도 아낀다).
  private fun startSonarTone(): AudioTrack? {
    return try {
      val bufferSize = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val samplesPerCycle = (SAMPLE_RATE / SONAR_TONE_HZ).toInt().coerceAtLeast(2)
      // 19kHz가 44.1kHz의 정확한 정수배 분주가 아니라 루프 지점에서 위상 불연속(작은 클릭)이 생길
      // 수밖에 없다 — 버퍼를 넉넉히 크게(2000사이클, ~90ms) 잡아 그 불연속 빈도 자체를 낮춘다
      // (완전한 해결은 스트리밍 합성이 필요하지만, 아직 로그 전용 V1이라 이 정도로 충분).
      val tone = ShortArray(samplesPerCycle * 2000)
      for (i in tone.indices) {
        tone[i] = (Short.MAX_VALUE * 0.3 * sin(2.0 * PI * SONAR_TONE_HZ * i / SAMPLE_RATE)).toInt().toShort()
      }
      val track = AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .build()
        )
        .setBufferSizeInBytes(max(bufferSize, tone.size * 2))
        .setTransferMode(AudioTrack.MODE_STATIC)
        .build()
      track.write(tone, 0, tone.size)
      track.setLoopPoints(0, tone.size, -1) // -1 = 무한 반복
      track.play()
      Log.i(TAG, "sonar tone started at ${SONAR_TONE_HZ}Hz")
      track
    } catch (e: Exception) {
      Log.w(TAG, "sonar tone start failed — sonar disabled this session", e)
      null
    }
  }

  // Goertzel의 I/Q(코사인/사인) 성분을 각각 구해 위상(atan2)까지 얻는 버전 — 기존 goertzelMagnitude는
  // 크기만 반환해 위상 정보가 없다. sonar는 "반사음이 있냐 없냐"가 아니라 "위상이 시간에 따라 어떻게
  // 변하냐"(=움직임의 방향/속도)를 봐야 하므로 별도로 둔다.
  private fun goertzelPhase(samples: ShortArray, targetHz: Double, sampleRate: Int): Double {
    val n = samples.size
    val k = (0.5 + (n * targetHz) / sampleRate).toInt()
    val w = (2.0 * PI / n) * k
    var real = 0.0
    var imag = 0.0
    for (i in samples.indices) {
      val angle = w * i
      real += samples[i] * cos(angle)
      imag -= samples[i] * sin(angle)
    }
    return atan2(imag, real)
  }

  fun hasPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  fun start(context: Context, onSnap: () -> Unit) {
    if (running) return
    if (!hasPermission(context)) {
      Log.w(TAG, "RECORD_AUDIO not granted — not starting")
      return
    }
    running = true
    sonarPhaseHistory.clear()
    sonarTrack = startSonarTone()
    thread = Thread { runDetectionLoop(onSnap) }.apply { start() }
  }

  fun stop() {
    running = false
    try {
      sonarTrack?.stop()
      sonarTrack?.release()
    } catch (_: Exception) {}
    sonarTrack = null
    sonarPhaseHistory.clear()
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

  // 2026-07-21 밤 감사 발견(웹 리서치: 스냅/박수 같은 임펄스성 브로드밴드 소음은 목소리·음악보다
  // zero-crossing rate가 훨씬 높다 — 표준 음성구간감지(VAD) 문헌에서 확립된 특징). 기존 하이/로우
  // 대역 에너지 비율(Goertzel) 하나만으로는 "큰 소리 + 고음 위주"인 다른 소리(예: 그릇 부딪히는
  // 소리, 일부 자음)도 통과시킬 여지가 있었다 — ZCR을 세 번째 독립 신호로 추가해 오탐을 줄인다.
  // 순수 함수라 실기기 없이도 로직 검증 가능(부호 전환 횟수 / 전체 샘플 수).
  private fun zeroCrossingRate(samples: ShortArray): Double {
    if (samples.size < 2) return 0.0
    var crossings = 0
    for (i in 1 until samples.size) {
      if ((samples[i - 1] >= 0) != (samples[i] >= 0)) crossings++
    }
    return crossings.toDouble() / samples.size
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

    // 2026-07-20 사용자 지시(맥 세션의 iOS 에코캔슬링 성공 사례 전달받음) — 영상 소리가 마이크에
    // 섞여 노이즈 바닥을 계속 올리던 문제(실기기 검증 9~10차에서 확인된 V1 한계)의 실제 해법.
    // 안드로이드도 표준 오디오 이펙트로 동일한 걸 제공한다 — AcousticEchoCanceler가 "스피커로
    // 나가는 소리 중 마이크로 되돌아온 성분"을 제거하고, NoiseSuppressor가 정상상태 배경 잡음을
    // 추가로 깎는다. 둘 다 새 의존성 없이 android.media.audiofx 표준 API. 기기가 지원 안 하면
    // (isAvailable()==false) 조용히 스킵 — 최악의 경우도 기존 V1 동작으로 그대로 폴백.
    var aec: AcousticEchoCanceler? = null
    var ns: NoiseSuppressor? = null
    if (AcousticEchoCanceler.isAvailable()) {
      aec = AcousticEchoCanceler.create(recorder.audioSessionId)?.apply { enabled = true }
      Log.i(TAG, "AcousticEchoCanceler enabled=${aec?.enabled}")
    } else {
      Log.w(TAG, "AcousticEchoCanceler not available on this device")
    }
    if (NoiseSuppressor.isAvailable()) {
      ns = NoiseSuppressor.create(recorder.audioSessionId)?.apply { enabled = true }
      Log.i(TAG, "NoiseSuppressor enabled=${ns?.enabled}")
    }

    val frame = ShortArray(FRAME_SIZE)
    var noiseFloor = 200.0 // 초기 추정치 — 조용한 프레임들로 서서히 적응
    var lastTriggerAt = 0L
    var lastHeartbeatAt = 0L
    var peakRmsSinceHeartbeat = 0.0
    var lastSonarLogAt = 0L

    try {
      recorder.startRecording()
      Log.i(TAG, "recording started")
      while (running) {
        val read = recorder.read(frame, 0, FRAME_SIZE)
        if (read <= 0) continue

        var sumSquares = 0.0
        for (i in 0 until read) {
          val s = frame[i].toDouble()
          sumSquares += s * s
        }
        val rms = sqrt(sumSquares / read)
        if (rms > peakRmsSinceHeartbeat) peakRmsSinceHeartbeat = rms

        val now = System.currentTimeMillis()
        // 2026-07-26 SONAR — 같은 프레임에서 19kHz 위상도 같이 뽑는다(별도 AudioRecord 없이 이 스트림
        // 하나 재사용, 위 SAMPLE_RATE 상향 코멘트 참고). 아직 어떤 결정에도 안 쓰고 로그만 남긴다.
        if (sonarTrack != null) {
          val phase = goertzelPhase(frame, SONAR_TONE_HZ, SAMPLE_RATE)
          sonarPhaseHistory.addLast(now to phase)
          while (sonarPhaseHistory.isNotEmpty() && now - sonarPhaseHistory.first().first > SONAR_PHASE_WINDOW_MS) {
            sonarPhaseHistory.removeFirst()
          }
        }
        // TEMP 튜닝용 로그(작업 끝나면 제거) — 1초마다 바닥/피크를 찍어 실제 임계값을 실측한다.
        if (now - lastHeartbeatAt > 1000) {
          Log.i(TAG, "heartbeat noiseFloor=$noiseFloor peakRms=$peakRmsSinceHeartbeat")
          lastHeartbeatAt = now
          peakRmsSinceHeartbeat = 0.0
        }
        // 2026-07-26 SONAR 캘리브레이션용 로그 — 위상 이력의 변화 폭(최댓값-최솟값)을 몇 초마다 찍는다.
        // 나중에 이 값의 실측 분포(무진동 vs 움직임 vs 호흡 중)를 보고 실제 게이팅 임계값을 정한다.
        if (sonarPhaseHistory.size >= 2 && now - lastSonarLogAt > SONAR_HEARTBEAT_MS) {
          val phases = sonarPhaseHistory.map { it.second }
          val range = (phases.maxOrNull() ?: 0.0) - (phases.minOrNull() ?: 0.0)
          Log.d(TAG, "sonar phaseRange=$range samples=${phases.size}")
          lastSonarLogAt = now
        }
        // 2026-07-20 실기기 검증 중 발견: 노이즈 바닥이 에코캔슬링 덕에 80~150대로 안정됐는데도
        // 사용자가 여러 번 스냅해도 이 문턱값(6배/800) 자체를 못 넘는 경우가 대부분이었다 — 실제
        // 스냅 음량이 이 기준보다 조용했다는 뜻. 바닥이 이제 낮고 안정적이니 배수/절대값 둘 다
        // 낮춰서 더 민감하게(오탐 여지는 늘지만, 지금은 아예 미탐이 훨씬 큰 문제).
        val isSpike = rms > noiseFloor * 3.5 && rms > 400.0
        val pastRefractory = now - lastTriggerAt > REFRACTORY_MS

        if (isSpike && pastRefractory) {
          val highMag = goertzelMagnitude(frame, HIGH_BAND_HZ, SAMPLE_RATE)
          val lowMag = goertzelMagnitude(frame, LOW_BAND_HZ, SAMPLE_RATE)
          val zcr = zeroCrossingRate(frame)
          val freqPassed = highMag > lowMag * 1.2
          // 웹 리서치 근거(VAD 문헌): 임펄스성 브로드밴드 소음(스냅/박수)은 ZCR이 목소리/음악보다
          // 뚜렷이 높다. MIN_ZCR은 초기 추정치 — 아래 로그로 실기기 실측 후 튜닝 대상.
          val zcrPassed = zcr > MIN_ZCR
          val passed = freqPassed && zcrPassed
          Log.i(TAG, "SPIKE rms=$rms noiseFloor=$noiseFloor highMag=$highMag lowMag=$lowMag zcr=$zcr passed=$passed (freq=$freqPassed zcr=$zcrPassed)")
          if (passed) {
            lastTriggerAt = now
            // 2026-07-20 실기기 검증 중 발견(사용자 지적 — "한번 안되면 계속 안되고", "이벤트가
            // 쌓였다가 한꺼번에 실행") — 이 감지 루프는 별도 백그라운드 Thread에서 돈다. 그런데
            // onSnap() 체인 끝의 dispatchGesture()는 알약 탭(메인 스레드에서 호출, 실기기 검증으로
            // accepted=true/onCompleted 정상 확인됨)과 달리 백그라운드 스레드에서 부르면 시스템이
            // 큐에 쌓아두다 늦게/한꺼번에 처리하거나 아예 막히는 것으로 보인다 — 메인 Looper로
            // 넘겨서 알약 탭과 동일한 스레드 조건으로 맞춘다.
            Handler(Looper.getMainLooper()).post { onSnap() }
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
      aec?.release()
      ns?.release()
      recorder.release()
    }
  }
}
