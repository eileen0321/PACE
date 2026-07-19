package expo.modules.paceoverlay

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.Looper

// 2026-07-20 Pace Feed(실제 youtube.com 페이지를 WebView로 띄우는 화면, feed/index.tsx) 전용
// MediaSession — PaceOverlayService의 세션(오버레이 알약/포그라운드 서비스 생명주기에 종속, 실제
// 외부 앱인 YouTube 재생 중에는 하드웨어 버튼을 절대 못 가져온다는 게 실기기로 확정됨,
// PACE_ARCHITECTURE.md "실기기 검증 7차" 참고)와는 완전히 별개다. Feed 화면은 Pace 자신이 진짜
// 오디오를 재생하는 유일한 케이스라(8차에서 확정) 이 MediaSession이 실제로 버튼을 가져올 가능성이
// 있는 첫 케이스 — AudioFocus 경쟁 로직은 PaceOverlayService에서 이미 검증된 패턴
// (GAIN_TRANSIENT_MAY_DUCK + OnAudioFocusChangeListener 재요청)을 그대로 재사용한다.
object PaceFeedMediaSession {
  private var mediaSession: MediaSession? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private var appContext: Context? = null
  private val handler = Handler(Looper.getMainLooper())

  // 모듈(PaceOverlayModule)이 세션 시작 시 채워주고, 종료 시 비운다 — 콜백 발생 시 JS로 이벤트를
  // 쏘는 역할은 모듈만 할 수 있어(sendEvent가 Module 인스턴스 메서드) 여기선 함수 참조만 들고 있는다.
  var onCommand: ((String) -> Unit)? = null

  private val audioFocusListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
    if (mediaSession == null) return@OnAudioFocusChangeListener
    when (focusChange) {
      AudioManager.AUDIOFOCUS_LOSS,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
        handler.postDelayed({ if (mediaSession != null) requestAudioFocus() }, 400)
      }
      else -> {}
    }
  }

  fun start(context: Context) {
    if (mediaSession != null) return
    appContext = context.applicationContext
    val session = MediaSession(context, "PaceFeedSession")
    session.setCallback(object : MediaSession.Callback() {
      override fun onSkipToNext() { onCommand?.invoke("next") }
      override fun onSkipToPrevious() { onCommand?.invoke("previous") }
      override fun onPlay() { onCommand?.invoke("playPause") }
      override fun onPause() { onCommand?.invoke("playPause") }
    })
    session.isActive = true
    mediaSession = session
    setPlaying(true)
    requestAudioFocus()
  }

  fun stop() {
    handler.removeCallbacksAndMessages(null)
    abandonAudioFocus()
    mediaSession?.release()
    mediaSession = null
    onCommand = null
  }

  fun setPlaying(playing: Boolean) {
    val state = PlaybackState.Builder()
      .setActions(
        PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
          PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS
      )
      .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, 0, 1f)
      .build()
    mediaSession?.setPlaybackState(state)
  }

  private fun requestAudioFocus() {
    val context = appContext ?: return
    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_UNKNOWN)
        .build()
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attrs)
        .setWillPauseWhenDucked(false)
        .setOnAudioFocusChangeListener(audioFocusListener, handler)
        .build()
      audioManager.requestAudioFocus(request)
      audioFocusRequest = request
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(audioFocusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
  }

  private fun abandonAudioFocus() {
    val context = appContext ?: return
    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
      audioFocusRequest = null
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(audioFocusListener)
    }
  }
}
