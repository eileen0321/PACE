import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { diagLog } from '../../services/diagLog';
import {
  isAllowedNavigation,
  sharedShortsPlayerStyles as styles,
  type ShortsPlayerHandle,
} from './sharedShortsPlayer';

// 2026-08-14(30차, 시뮬레이터 진단으로 발견) — requireOptionalNativeModule을 모듈 top-level에서
// 즉시 호출(예전 코드)하면 이 파일이 import되는 시점(앱 부트스트랩 초반, 네이티브 모듈 레지스트리가
// 아직 다 안 채워졌을 수 있는 시점)의 스냅샷이 최상위 const에 영구 캐시된다 — 그 시점에 아직
// "PaceGesture"가 없으면 null이 그대로 굳어 버려, 이후 모듈이 실제로 등록돼도 절대 안 바뀐다.
// (bluetoothService.ios.ts의 같은 호출은 화면 마운트 후 지연 호출이라 이 문제가 없었다 — 그래서
// 그쪽 로그는 찍히는데 여기 domlog만 처음부터 끝까지 단 한 줄도 안 찍히는 비대칭이 났다.)
// → 매번 다시 조회하는 함수로 바꿔 이 캐시 문제를 없앤다.
function getPaceGestureLog() {
  return requireOptionalNativeModule<{ nativeLog(msg: string): void }>('PaceGesture');
}

// iOS 전용 TikTok 플레이어. `src/app/dev/tiktok-poc.tsx`(DEV PoC)에서 2026-08-12~13 밤 동안
// 검증한 기법을 그대로 프로덕션 컴포넌트 형태로 옮긴 것 — 실기기에서 데스크톱 UA로 자동 다음영상
// 넘김을 확인했고, 이어서 시뮬레이터에서 재현한 4개 버그(재생 중 끊김/무한 리플레이/영구 고착/
// RN UI 소실)를 전부 고친 뒤의 최종 형태다. 자세한 조사 히스토리는 `QA_MATRIX.md` 2026-08-12/13
// 섹션과 `tiktok-poc.tsx` 헤더 코멘트 참고.
//
// YouTubeShortsPlayer.ios.tsx와의 핵심 차이:
//  - **큐레이션 없음** — 유튜브는 PACE가 고른 videoId 순서를 스와이프 주입으로 이어가지만, 틱톡은
//    페이지 자체(`tiktok.com/foryou`)를 한 번만 로드하고 틱톡 자신의 추천 알고리즘에 맡긴다.
//    `videoId`/`listMode`/`onNotShorts` 같은 큐 관련 prop이 없다(그 개념 자체가 없음).
//  - **다음 영상 트리거가 완전히 다르다** — 유튜브는 스와이프 시뮬레이션(방향키+스크롤)로 자기
//    피드를 넘기지만, 틱톡 데스크톱 UA 페이지는 실기기에서 그 방식이 전혀 안 먹혔다(합성 이벤트
//    여러 종류 + 진짜 손가락 스와이프까지 전부 무반응). 대신 **자연 종료 감지(ended 이벤트 +
//    재생위치 폴링) → 확인될 때까지 여러 기법을 순서대로 재시도**하는 구조로 완전히 다르게 짰다.
//  - **데스크톱 UA 고정** — 모바일 Safari UA로는 8개 기법이 전부 1회 이동 후 영구 고착됐다(실기기
//    진짜 손가락 포함). 데스크톱 Chrome/Mac UA로 위장하면 계속 넘어간다(원인: 모바일 웹은 앱 설치
//    유도를 위해 의도적으로 제한, 데스크톱은 그 제한이 없음 — QA_MATRIX.md 2026-08-12 섹션).
//  - **playsinline 강제 필수** — 데스크톱 UA 페이지의 <video>는 playsinline 속성이 없어(진짜
//    데스크톱 브라우저는 필요 없음), iOS WKWebView가 네이티브 전체화면으로 승격해 RN UI 전체를
//    덮는 버그가 있었다(Apple Developer Forums에 보고된 iOS WKWebView 인라인 실패 패턴과 일치,
//    추측 아니라 웹서치로 확정). injectedJavaScriptBeforeContentLoaded로 페이지 스크립트보다
//    먼저 막는다.

type Props = {
  playing: boolean;
  onEnded: () => void;
  onReady?: () => void;
  onError?: (code: number) => void;
  /** 재생 진행률(0~1) — 피드의 고개짓 카메라 배터리 게이팅용(유튜브 플레이어와 동일 용도). */
  onProgress?: (fraction: number) => void;
  /**
   * 2026-08-15 — 유튜브 쪽(YouTubeShortsPlayer.ios.tsx)에 넣은 것과 같은 목적: 이 WebView가
   * 콜드 스타트할 때 물리 무음 스위치 상태를 미리 알려줘서, RN의 첫 checkSilentSwitch() 응답
   * (200~300ms 비동기)이 오기 전에 새 video가 TikTok 기본 상태(대개 muted=false)로 잠깐 소리
   * 내며 재생되는 걸 막는다. window.__paceMuted를 이 값으로 미리 세팅한 뒤 나머지 스크립트를
   * 붙인다 — onLoadStart/onLoad 재주입(아래, 실기기에서 동작 확인됨)과
   * injectedJavaScriptBeforeContentLoaded prop(이 환경에서 실행 안 될 수 있다고 기록돼 있었으나
   * 2026-08-15 유튜브 쪽에서 domlog(__PACE_DIAG__ 게이트)가 실제로 찍히는 걸 확인해 그 기록이
   * RNW 16.0.0 업그레이드 이전 것일 가능성이 높음 — 안전하게 양쪽 다 세팅) 양쪽에 다 쓴다.
   */
  initialMuted?: boolean;
};

const INJECTED_JS_BEFORE_LOAD = `
(function() {
  // 2026-08-14(31차) — injectedJavaScriptBeforeContentLoaded prop이 이 환경(RNW 13.16.1 +
  // Fabric)에서 실행 안 되는 걸 시각적 테스트로 확정한 뒤, 컴포넌트 쪽에서 onLoadStart/onLoad마다
  // imperative injectJavaScript(ref)로 이 스크립트를 재주입하도록 바꿨다 — 그 결과 같은 문서에
  // 이 스크립트가 여러 번 들어올 수 있다(중복 setInterval 등록 방지 필요).
  if (window.__paceTikTokInit) return;
  window.__paceTikTokInit = true;
  function send(o) { try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e) {} }
  // 2026-08-14(27차) 진단으로 실기기에서 확정(추측 아님): injectedJavaScript(페이지가 "완전히
  // 로드 끝남" 판정을 받은 뒤에만 주입되는 별도 prop)는 틱톡이 로딩 상태에 갇히면(반복 재현)
  // 그 판정이 영영 안 나서 **한 번도 실행되지 않았다** — 배너닫기/게이트통과/자동넘김 등 핵심
  // 로직 전부가 여기 있었는데 전부 죽어있던 것. 이 BeforeContentLoaded는 항상 실행되는 게
  // 로그로 확인됐으므로(아래 진단 라인), 핵심 로직을 전부 여기로 옮기고 "완전 로드"가 아니라
  // DOMContentLoaded(HTML 파싱 완료 시점 — 훨씬 이르고, 네트워크가 유휴 상태가 되길 기다리지
  // 않음) 시점에 실행한다. injectedJavaScript prop 자체는 이제 안 쓴다(중복 초기화 방지).
  send({ type: 'domlog', text: '🟡 BeforeContentLoaded 실행됨 t=' + Date.now() });
  // 🔴 2026-08-16(12차, 구조적 마감) — 왼쪽 사이드바 "나왔다 사라짐"이 11번의 수정에도 재발한
  // 구조적 이유: 지금까지 전부 "틱톡이 먼저 그림 → 우리 JS 폴링이 찾아서 인라인 display:none"
  // 순서라, 리액트가 노드를 새로 만들/재활용할 때마다 다음 틱까지의 노출 창이 원리상 반드시
  // 남았다(50ms로 줄여도 0이 안 됨). CSS 스타일시트 규칙은 엘리먼트가 언제 마운트되든 첫 페인트
  // 전 스타일 해석 단계에서 적용되므로 이 경쟁 자체가 없다 — 문서 최초 시점(여기)에 규칙을
  // 심으면 사이드바는 단 한 프레임도 그려질 수 없다. 클래스명이 순수 해시라 셀렉터가 불가능한
  // /live 등은 기존 hideLeftRailByGeometry(폴링)가 백업으로 계속 커버한다. head가 아직 없을 수
  // 있어 documentElement 폴백 + 이후 틱(sweepHideUndecided)에서 재확인.
  function ensureStaticHideCss(){
    try {
      if (document.getElementById('pace-static-hide')) return;
      var st = document.createElement('style');
      st.id = 'pace-static-hide';
      // 🔴 13차(실기기 콘솔 로그로 확정) — 기기에선 페이지 로딩 중 **스켈레톤 사이드바**(클래스
      // DivSkeletonSide..., w=72 세로 긴 자리표시자)가 진짜 사이드바보다 먼저 뜬다. 진짜 쪽
      // (DivSideNavContainer)은 이 스타일시트로 computed=none이 확인됐는데 스켈레톤은 클래스가
      // 달라 50ms 지오메트리 폴링에만 걸렸고, 로딩이 느린 기기에서 커버 안전장치(10초)가 풀린
      // 뒤 그대로 노출됐다 — "처음 켤 때 왼쪽 아이콘 바"의 실기기 잔존 원인. 같이 정적으로 숨긴다.
      // 🔴 2026-08-17(사장님 "왜 다음 영상 가져올 때부터 사이즈를 제대로 못 재냐") — 못 재는 게
      // 아니라 재는 대상(영상 SECTION 박스)이 태어난 뒤 변한다: 페이지 아이콘 열(형제 SECTION)을
      // JS로 늦게 숨기면 flex 재계산으로 영상 박스가 그때 넓어지고(실측 348→402), 재활용 노드는
      // 틱톡 리액트가 아이콘 열을 되살려 이 과정이 활성화 후 반복 — "작게 왔다 커짐"의 구조적
      // 원인. 아이콘 열을 문서 시작 시점 CSS(:has, iOS 15.4+ WebKit 지원)로 태어나기 전에 죽여
      // 영상 박스가 처음부터 최종 폭으로 태어나게 한다. 페이지 아이콘은 RN 오버레이가 대체하므로
      // 보일 일이 없고, 이제 모든 아이템이 폭 채움이라 '원본 그대로 두기' 케이스도 없다.
      st.textContent = '[class*="DivSideNavContainer"],[class*="DivSideNavPlaceholderContainer"],[class*="DivSkeletonSide"]{display:none!important}'
        + '[data-e2e="recommend-list-item-container"] section:has([data-e2e="like-icon"]){display:none!important}';
      var host = document.head || document.documentElement;
      if (host) host.appendChild(st);
    } catch(eCss) {}
  }
  ensureStaticHideCss();
  // 🔴 사장님 실기기 지적("스와이프 하면 화면이 작게 보였다 커져") — pollActiveVideo(500ms 폴링)로
  // "영상 바뀜"을 감지해 즉시 판단을 돌리게 고쳤지만(3000ms→최대 500ms), 그 사이 창은 여전히 남는다:
  // 틱톡 자체 스크롤 스냅이 새 영상을 원래(레터박싱) 크기로 이미 화면에 그려버린 뒤에야 우리 폴링이
  // 따라잡아 스케일을 건다 — 그 gap 동안 "작았다가 커지는" 게 실제로 보인다. 폴링 주기를 아무리
  // 줄여도(끝까지 0으로 못 줄임) 이 경쟁 자체는 없어지지 않는다. **판단 전엔 아예 안 보이게** 근본
  // 해결: data-pace-fs-decided가 아직 없는(우리가 아직 못 본) video-SECTION은 CSS로 기본
  // visibility:hidden 처리해두고, hideIconRailAndScaleVideo가 그 속성을 찍는 순간(스케일 적용까지
  // 같은 동기 실행 안에서 끝남) 셀렉터가 안 맞게 돼 자동으로 보인다 — "작다가 커짐" 대신 "잠깐
  // 안 보이다가(배경은 이미 검은색) 바로 완성된 크기로 나타남"으로 바뀐다. 이 규칙은 DOMContentLoaded
  // 이전(BeforeContentLoaded, 가장 이른 시점)에 심어야 어떤 영상이 처음 나타나든 놓치는 창이 없다.
  // 🔴 2026-08-16(재확인, 실기기 진단 로그로 원인 확정) — CSS(:has(video:not(...))) 방식도,
  // MutationObserver(addedNodes 감지) 방식도 실기기에서 똑같이 안 먹혔다. 진단 로그(👁️공개
  // priorVis=)로 실측 확정: willFullscreen=true로 풀스크린 전환되는 케이스는 매번 priorVis가
  // 빈 문자열(= 한 번도 숨겨진 적 없음)이었다 — 반면 스킵 케이스는 priorVis=hidden으로 정상
  // 작동했다. 결론: **틱톡이 다음 영상 SECTION을 스와이프 전에 미리(preload) DOM에 만들어
  // 둔다** — 그래서 "새로 삽입되는 순간"을 잡는 MutationObserver의 addedNodes에는 아예 안
  // 걸린다(이미 그 전에 삽입돼 있었으므로). CSS :has()도 재검토 결과 같은 근본 문제였을 가능성.
  // **해결: 삽입 이벤트를 기다리지 않고, 주기적으로 DOM 전체를 훑어 "아직 판단 안 된" video를
  // 능동적으로 찾아 숨긴다.**
  // 🔴 2026-08-16(재재확인, 실기기 재현) — 처음엔 pollActiveVideo(500ms)에만 얹었는데, 사람이
  // 빠르게 연속 스와이프하니 여전히 재현("priorVis=" 빈 문자열로 로그 확인) — 틱톡의 preload
  // 여유가 500ms/150ms보다 짧아지는 경우가 있었다.
  // 🔴 2026-08-16(5차, "그게 최선이야?" — 사장님 지시로 검정 화면 자체를 없애는 작업) — "숨겼다가
  // 판단되면 보여주기"는 활성(화면에 보이는) 영상에만 의미가 있다. 틱톡은 스와이프하기 훨씬 전에
  // (몇 초 전, 이미 확인됨) 다음 영상 SECTION을 미리 DOM에 만들어둔다 — 그렇다면 "활성화될 때
  // 판단"이 아니라 "화면 밖에 있을 때 이미 미리 판단+스케일까지 끝내두면" 활성화되는 순간엔 이미
  // 완성된 크기라 숨길 필요 자체가 없어진다. sweepHideUndecided를 "숨기기"가 아니라 "화면 밖 영상
  // 전부 미리 판단·스케일"로 바꾼다 — decideVideoOffscreen이 실제 판단/적용을 맡고, 아직 활성이
  // 아니므로 z-index는 낮은 값(1)만 준다(활성이 되면 hideIconRailAndScaleVideo가 999로 승격 —
  // 예전에 고쳤던 "다음 피드 아이템이 확대된 영상 위로 겹쳐 보이는" 버그가 여러 영상을 동시에
  // 미리 스케일해두면서 재발하지 않도록, "지금 실제로 보이는 영상만 최상단"을 유지하기 위함).
  // 🔴 2026-08-17(사장님 재보고 "스위프트 넘길때 다음 영상 멈칫하고 버벅") — 지금까지 게이트 문구
  // 체크가 document.body.innerText(페이지 전체 텍스트 직렬화 = 강제 레이아웃)를 **50ms마다** 돌리고
  // 있었다(초당 20회). 실측: 스와이프 직후 창에서 300ms+ 정지가 25회 중 7회, 최악 966ms. 게이트는
  // 초 단위로만 나타났다 사라지는 상태라 1초 캐시로 충분하다 — 강제 레이아웃을 20분의 1로 줄인다.
  function gateTextVisible(){
    try {
      var nowG = Date.now();
      // 게이트는 세션 초기에만 유의미 — fsDecided 이후엔 재검사 주기를 3초로 늘려 innerText
      // 직렬화(수십 ms급 강제 레이아웃) 빈도를 더 줄인다("그래도 멈칫" 재보고 후속).
      var gTtl = window.__paceFsDecidedSent ? 3000 : 1000;
      if (window.__paceGateCheckAt && (nowG - window.__paceGateCheckAt) < gTtl) return !!window.__paceGateCached;
      window.__paceGateCheckAt = nowG;
      var btG = document.body.innerText || '';
      window.__paceGateCached = btG.indexOf('무엇을 시청하고') !== -1 || btG.indexOf('관심사') !== -1 || btG.indexOf('what you') !== -1;
      return !!window.__paceGateCached;
    } catch(eGt) { return false; }
  }
  function decideVideoOffscreen(vid, container){
    try {
      var vh = window.innerHeight || 0;
      var vw = window.innerWidth || 0;
      if (!vh || !vw) return;
      var sec = vid, sg = 0;
      while (sec && sec.tagName !== 'SECTION' && sg < 8) { sec = sec.parentElement; sg++; }
      var target = sec || vid;
      var vsrc = vid.currentSrc || vid.src || '';
      // 🔴 12차 — 재활용 노드가 이전 영상 때 우리가 건 transform(scale)을 그대로 갖고 있으면 이미
      // 커진 크기를 재서 willFullscreen=false로 오판한다(활성 경로 hideIconRailAndScaleVideo는
      // 재기 전에 지우는데 이 사전판단 경로만 빠져 있었다 — 스와이프 직후 "작게 보였다 커짐"의
      // 남은 원인). 동일하게 transition 끄고 지운 뒤 잰다.
      if (target.style.getPropertyValue('transform')) {
        target.style.setProperty('transition', 'none', 'important');
        target.style.removeProperty('transform');
      }
      var r = target.getBoundingClientRect();
      var willFullscreen = false;
      var scale = 1;
      if (r.height && r.height < vh - 1) {
        var scaleH = vh / r.height;
        var scaleW = r.width ? vw / r.width : scaleH;
        if (scaleH > 1.01 && scaleH <= 2.2 && scaleH / scaleW <= 1.25) {
          // 2026-08-17(사장님 "왜 하단의 글자가 잘려" → "여전히 잘려") — 세로 채움의 가로 크롭이
          // 캡션(영상 박스 안 오버레이)을 같이 잘랐다. 6% 상한으로도 잘린다는 재보고에 크롭을
          // **0으로 확정**(정확히 폭 맞춤) — 잘릴 수학적 여지 제거. 박스가 이미 풀폭이면 배율
          // 1.0으로 세로 중앙(translateY)만 맞춘다. 위아래 얇은 여백은 검정 배경이라 티 안 남.
          scale = Math.min(scaleH, Math.max(scaleW, 1)); willFullscreen = true;
        } else if (scaleW > 1.01 && scaleW <= 2.6) {
          // 🔴 2026-08-16(13차, 진짜 스와이프 녹화 프레임 분석으로 확정) — 사장님이 보던 "스와이프하면
          // 화면 작아지고 오른쪽에 아이콘" 재현 프레임 2건이 전부 4:5/가로형 등 비표준 비율 영상이었다.
          // 예전에 "비표준 비율은 스킵하고 페이지 원본 그대로"로 설계한 케이스가 바로 그 증상이었던 것
          // (스킵되면 데스크톱 레이아웃 크기 그대로 작게 + 페이지 아이콘 열 노출). 스킵 대신 네이티브
          // 틱톡이 가로 영상을 다루는 방식대로 **가로 폭 기준으로 채운다** — 위아래는 검은 여백으로
          // 남고(원래 배경이 검정) 아이콘은 RN 오버레이로 통일된다. 폭 기준이라 좌우 크롭·잘림이 없어
          // 예전 스킵 사유(균일 스케일 시 폭이 밖으로 밀려 잘림)가 발생하지 않는다.
          scale = scaleW; willFullscreen = true;
        }
      }
      target.setAttribute('data-pace-fs-decided', willFullscreen ? 'yes' : 'no');
      target.setAttribute('data-pace-fs-src', vsrc);
      vid.setAttribute('data-pace-fs-decided', willFullscreen ? 'yes' : 'no');
      vid.setAttribute('data-pace-fs-src', vsrc);
      // 🔴 2026-08-17(사장님 재보고 "다음 영상 멈칫") — 스와이프 진입 직후 정지의 큰 지분은 새 영상
      // 버퍼링(첫 프레임까지 네트워크 대기)이다. 틱톡이 DOM 노드는 미리 만들어도 미디어 데이터까지
      // 미리 받는다는 보장이 없어, 화면 밖에서 판단하는 이 시점에 preload=auto를 강제해 데이터를
      // 미리 받게 한다 — 활성화되는 순간 이미 버퍼가 차 있어 바로 재생된다.
      try { if (vid.preload !== 'auto') vid.preload = 'auto'; } catch(ePre) {}
      // 🔴 12차 — 페이지 자체 아이콘 열(SECTION)은 지금까지 활성화 시점에만 숨겨서, 미리 스케일해둔
      // 새 영상이 화면에 들어오는 순간엔 아이콘이 아직 보였다(스와이프마다 "오른쪽 아이콘 떴다
      // 사라짐"). 판단을 여기서 이미 끝내므로 숨김(yes)/복원(no)도 같은 동기 실행에서 끝내둔다 —
      // 활성 경로의 숨김/스킵복원 로직과 같은 규칙.
      var likeOff = container ? container.querySelector('[data-e2e="like-icon"]') : null;
      if (likeOff) {
        var railOff = likeOff, rg = 0;
        while (railOff && railOff.tagName !== 'SECTION' && rg < 10) { railOff = railOff.parentElement; rg++; }
        if (railOff && railOff.tagName === 'SECTION') {
          if (willFullscreen) {
            if (railOff.style.display !== 'none') railOff.style.setProperty('display', 'none', 'important');
          } else if (railOff.style.display === 'none') {
            railOff.style.removeProperty('display');
          }
        }
      }
      if (!willFullscreen) return;
      // 🔴 13차(밤 자율 루프, 녹화 프레임으로 발견) — 가로형(폭 채움) 영상이 화면 중앙보다 ~6%
      // 아래에 붙는다: SECTION이 피드 아이템 안에서 세로 오프셋을 갖고 있는데 scale만 걸고 위치
      // 보정을 안 해서다. 아이템 컨테이너(스크롤 스냅 단위, 뷰포트 크기) 중심으로 translateY 보정 —
      // transform은 레이아웃에 안 끼므로 스냅 계산과 무관하게 안전하고, 두 rect가 같은 스크롤
      // 오프셋을 공유해 화면 밖 프리로드 영상에도 정확하다.
      var dyOff = 0;
      try {
        if (container) {
          var crOff = container.getBoundingClientRect();
          dyOff = (crOff.top + crOff.height / 2) - (r.top + r.height / 2);
        }
      } catch(eDyOff) {}
      target.style.setProperty('transition', 'none', 'important');
      target.style.setProperty('transform', 'translateY(' + dyOff.toFixed(1) + 'px) scale(' + scale.toFixed(4) + ')', 'important');
      target.style.setProperty('transform-origin', 'center center', 'important');
      target.style.setProperty('position', 'relative', 'important');
      // loadedmetadata 직행 경로가 "지금 활성인" 섹션에도 들어올 수 있다 — 활성 표식(999)을 1로
      // 끌어내리면 인접 아이템 비침 회귀가 나므로 999는 건드리지 않는다.
      if (target.style.getPropertyValue('z-index') !== '999') {
        target.style.setProperty('z-index', '1', 'important');
      }
      var el2 = vid, guard2 = 0;
      while (el2 && guard2 < 2) {
        if (el2.tagName === 'SECTION' || el2.tagName === 'DIV') {
          el2.style.setProperty('overflow', 'visible', 'important');
        }
        el2 = el2.parentElement;
        guard2++;
      }
    } catch(eOff) {}
  }
  function sweepHideUndecided(){
    try {
      // 🔴 13차(사장님 실기기 재보고 "스와이프하면 화면이 멈췄다가 버벅") — 예전엔 여기(50ms 틱)서
      // hideLeftRailByGeometry를 같이 돌렸는데, 그 함수는 문서의 **모든 div에 getBoundingClientRect**
      // 를 강제한다(초당 20회 전체 레이아웃 계산 = 스크롤 중 프레임 낙하의 직접 원인). 사이드바/
      // 스켈레톤은 이제 문서 시작 시점 정적 CSS가 원천 차단하므로 비싼 지오메트리 스캔은 원래대로
      // houseKeeping(3초, /live 등 클래스가 순수 해시인 페이지 백업용)에만 남기고 여기선 뺀다.
      // ensureStaticHideCss는 getElementById 1회라 공짜 — 유지.
      ensureStaticHideCss();
      // 🔴 hideIconRailAndScaleVideo와 동일 이유(9차 주석 참고) — 관심사 게이트가 떠 있는 동안은
      // 화면 밖 프리로드 영상 판단도 통째로 미룬다. 이 스윕은 컨테이너마다 반복 도는 루프라 게이트
      // 문구 체크를 루프 밖(한 번만)에서 해서 낭비를 줄인다.
      if (gateTextVisible()) return;
      // (철회) 한때 여기 "스크롤 중 사전판단 유예"가 있었다 — 30fps 프레임 분석으로 역효과 확정:
      // 스와이프 중 재활용된 새 섹션이 유예 때문에 스케일 안 된 채 화면에 들어왔다가 멈춘 뒤에야
      // 커지는 게 "화면 조정" 그 자체였다. 사전판단의 존재 이유가 "활성화 전에 미리"이므로
      // 스크롤 중에도 그대로 돈다(작업량은 미판단 노드가 있을 때만 발생 — 스와이프당 1~2회 수준).
      var containers3 = document.querySelectorAll('[data-e2e="recommend-list-item-container"]');
      for (var ci3 = 0; ci3 < containers3.length; ci3++) {
        var vids3 = containers3[ci3].querySelectorAll('video');
        for (var vi3 = 0; vi3 < vids3.length; vi3++) {
          var vid3 = vids3[vi3];
          // 🔴 재활용 노드 대응 — hideIconRailAndScaleVideo와 동일 로직(src 불일치=재활용된 새
          // 내용이므로 "판단 안 됨"으로 취급). 이게 없으면 재활용된 노드가 이전 영상 때 찍힌
          // decided 속성을 그대로 갖고 있어 여기서 계속 스킵되고, 새 내용이 숨겨지지 않는다.
          var vsrc3 = vid3.currentSrc || vid3.src || '';
          if (vid3.getAttribute('data-pace-fs-decided') && vid3.getAttribute('data-pace-fs-src') === vsrc3) continue;
          decideVideoOffscreen(vid3, containers3[ci3]);
        }
      }
    } catch(eSweep) {}
  }
  sweepHideUndecided();
  // 🔴 2026-08-16(3차) — 150ms 인터벌도 실기기 로그로 여전히 놓치는 게 확인됨(스와이프 직전
  // priorVis가 빈 문자열인 미스가 4번 중 2번) → requestAnimationFrame(매 프레임)로 바꿨었다.
  // 🔴 2026-08-16(6차, 진단으로 원인 확정) — rAF 루프 자체가 문제였다: 진단 로그(💓sweepLoop
  // frame=)를 심어보니 frame=1은 찍히는데 8초 넘게 frame=300(약 5초 분량)이 안 찍힘 — WKWebView
  // 안에서 컴포지터/디스플레이 갱신 우선순위에 안 걸리면 requestAnimationFrame이 사실상 멈추는
  // (또는 극단적으로 스로틀되는) 것으로 보인다(알려진 WKWebView 특성 — 실제 화면 애니메이션이
  // 없으면 rAF가 우선순위 밀림). setInterval은 pollActiveVideo(500ms)/houseKeeping(3000ms) 둘 다
  // 로그로 계속 살아있는 게 확인돼 신뢰할 수 있다 — rAF 대신 촘촘한 setInterval(50ms)로 되돌린다.
  setInterval(sweepHideUndecided, 50);
  // 🔴 2026-08-16(13차) — 50ms 스윕도 "활성화되는 바로 그 순간 노드가 재활용되는" 경우엔 한 틱
  // 늦는다(그 사이 원본 크기+페이지 아이콘이 잠깐 보였다가 커짐 — 실기기에서 잔존 재현). 폴링을
  // 더 줄이는 대신 이벤트로 잡는다: 재활용이든 신규든 새 영상이 붙으면 반드시 loadstart가 발화
  // 하므로(미디어 이벤트는 버블링은 안 하지만 캡처 단계 문서 리스너에는 걸린다), 그 즉시 재판단
  // 해서 스케일/아이콘 숨김을 같은 순간에 끝낸다.
  try {
    document.addEventListener('loadstart', function(evLs){
      try {
        var tLs = evLs.target;
        if (!tLs || tLs.tagName !== 'VIDEO') return;
        var cLs = tLs.closest ? tLs.closest('[data-e2e="recommend-list-item-container"]') : null;
        if (cLs) decideVideoOffscreen(tLs, cLs);
      } catch(eLs2) {}
    }, true);
    // 🔴 "스와이프 후 화면 조정" 즉시 보정 — 메타데이터 도착(loadedmetadata)으로 영상 비율이
    // 확정되는 순간 박스 크기가 바뀔 수 있다. 폴링(500ms)을 기다리지 않고 그 즉시 재판단해서
    // 크기가 어긋난 프레임이 화면에 남는 창을 이벤트 단위로 좁힌다.
    document.addEventListener('loadedmetadata', function(evLm){
      try {
        var tLm = evLm.target;
        if (!tLm || tLm.tagName !== 'VIDEO') return;
        var cLm = tLm.closest ? tLm.closest('[data-e2e="recommend-list-item-container"]') : null;
        if (cLm) decideVideoOffscreen(tLm, cLm);
      } catch(eLm2) {}
    }, true);
  } catch(eLs) {}
  try {
    if (typeof Element !== 'undefined' && Element.prototype.requestFullscreen) {
      Element.prototype.requestFullscreen = function(){ return Promise.reject(new Error('blocked')); };
    }
    if (typeof HTMLVideoElement !== 'undefined' && HTMLVideoElement.prototype.webkitEnterFullscreen) {
      HTMLVideoElement.prototype.webkitEnterFullscreen = function(){};
    }
    // 2026-08-14(32차) — webkitEnterFullscreen(구식 API)과 별개로, 최신 WebKit은
    // webkitSetPresentationMode('fullscreen'/'picture-in-picture')라는 AVKit 연동 API를 따로
    // 갖고 있다. 사이트가 자체 "극장 모드"/커스텀 전체화면 버튼에 이걸 직접 쓰면 위 오버라이드로는
    // 안 잡힌다 — 같이 막는다.
    if (typeof HTMLVideoElement !== 'undefined' && HTMLVideoElement.prototype.webkitSetPresentationMode) {
      HTMLVideoElement.prototype.webkitSetPresentationMode = function(){};
    }
  } catch(e) {}
  // 2026-08-14(29차, 시뮬레이터로 재현 확정) — 위 webkitEnterFullscreen 오버라이드 +
  // createElement/play() 가로채기(둘 다 이미 있었음)로도 여전히 네이티브 전체화면이 뚫렸다.
  // 이유: webkitEnterFullscreen 오버라이드는 "페이지가 그 JS 메서드를 직접 호출하는" 경로만
  // 막는다 — WKWebView 엔진이 재생 시작 시 playsinline 부재를 보고 **자체적으로** 승격을
  // 결정하는 건 JS 메서드 호출이 아니라 엔진 내부 로직이라 이 오버라이드로 안 잡힌다. 또한
  // 비디오가 innerHTML로 삽입되고 autoplay 속성만으로 재생되면 createElement도 play()도 안
  // 거친다. → 진입을 막는 대신, 진입한 "순간"을 이벤트로 잡아 **즉시 되돌린다**(어떤 경로로
  // 들어갔든 상관없이 동작 — 커뮤니티에 알려진 WKWebView 우회 패턴).
  try {
    document.addEventListener('webkitbeginfullscreen', function(ev) {
      try { send({ type: 'domlog', text: '🟠 네이티브 전체화면 진입 감지(이벤트) → 즉시 해제' }); } catch(e2) {}
      try { ev.target && ev.target.webkitExitFullscreen && ev.target.webkitExitFullscreen(); } catch(e2) {}
    }, true);
  } catch(e) {}
  // 2026-08-14(30차, 시뮬레이터로 확정) — 위 이벤트 리스너를 달아도 실제로 전체화면에 들어간 뒤
  // (WebKit 네이티브 로그로 didBecomeFullscreenElement 확인) 빠져나오는 시도 자체가 한 번도
  // 안 잡혔다 — 최신 WebKit의 AVPlayerViewController 기반 전체화면 구현에서는
  // 'webkitbeginfullscreen' 이벤트가 우리 기대와 다르게 동작하는 것으로 보인다(버블링/캡처
  // 여부가 예전 구현과 다를 수 있음). 이벤트에 기대는 대신 **상태를 직접, 짧은 주기로 감시**해서
  // 확실하게 잡는다 — video.webkitDisplayingFullscreen은 실제 네이티브 전체화면 표시 여부를
  // 그대로 반영하는 읽기전용 프로퍼티라 이벤트 발화 여부와 무관하게 항상 정확하다.
  try {
    setInterval(function() {
      try {
        var vids = document.querySelectorAll('video');
        for (var i = 0; i < vids.length; i++) {
          var v = vids[i];
          var inFullscreen = v.webkitDisplayingFullscreen || (v.webkitPresentationMode && v.webkitPresentationMode !== 'inline');
          if (inFullscreen) {
            send({ type: 'domlog', text: '🟠 전체화면 감시(폴링)로 감지(mode=' + v.webkitPresentationMode + ') → 해제 시도' });
            ensureInline(v);
            try { v.webkitExitFullscreen(); } catch(e2) {}
            try { if (v.webkitSetPresentationMode) v.webkitSetPresentationMode('inline'); } catch(e2) {}
          }
        }
      } catch(e2) {}
    }, 250);
  } catch(e) {}
  function ensureInline(v){ try { v.setAttribute('playsinline','true'); v.setAttribute('webkit-playsinline','true'); v.playsInline = true; } catch(e) {} }
  // 2026-08-14(실기기 재현) — MutationObserver로 나중에 playsinline을 붙이는 방식은 **비동기라
  // 진다**: 틱톡이 같은 틱(synchronous)에서 <video>를 만들고 바로 .play()를 부르면, WKWebView
  // 엔진은 그 순간의 DOM 속성(playsinline 없음)만 보고 즉시 네이티브 전체화면으로 승격한다 —
  // MutationObserver 콜백은 그 뒤(다음 마이크로태스크)에나 도착해 이미 늦는다. 네이티브
  // 전체화면은 RN 뷰 트리 전체(P버튼 포함)를 덮는 모달이라, 이게 실기기에서 "같은 영상 반복 +
  // P메뉴 실종"의 실제 원인이었다(웹서치 확인: WKWebView는 playsinline 부재 시 자동 승격이 JS로
  // 가로챌 수 있는 메서드 호출이 아니라 엔진 내부 결정이라 webkitEnterFullscreen 오버라이드로도
  // 못 막음). → video 엘리먼트가 **생성되는 그 순간**(createElement)과 **play()가 불리는 그
  // 순간** 둘 다에서 동기적으로 playsinline을 강제한다 — 레이스 자체를 없앤다. MutationObserver는
  // innerHTML 등 createElement를 안 거치는 경로를 위한 3중 안전망으로 유지.
  try {
    var origCreateElement = document.createElement;
    document.createElement = function(tagName) {
      var el = origCreateElement.apply(document, arguments);
      try { if (String(tagName).toLowerCase() === 'video') ensureInline(el); } catch(e) {}
      return el;
    };
  } catch(e) {}
  try {
    if (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype.play) {
      var origPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() {
        ensureInline(this);
        return origPlay.apply(this, arguments);
      };
    }
  } catch(e) {}
  try {
    var mo0 = new MutationObserver(function(){
      var list = document.querySelectorAll('video');
      for (var i = 0; i < list.length; i++) {
        ensureInline(list[i]);
        // 2026-08-15 사장님 실기기 재보고("전환될 때 소리 잠깐 남, 니가 고친 500ms 안전망도 아직
        // 들림") — 폴링(500ms든 tryAdvance든)은 새 video가 이미 재생을 시작한 "뒤"에야 따라잡아
        // 그 틈만큼 소리가 샌다. 이 MutationObserver는 새 <video> 요소가 DOM에 **삽입되는 그 순간**
        // (재생 시작 전, playsinline 강제와 같은 타이밍)에 발화하므로, 여기서 무음을 걸면 TikTok
        // 자신의 첫 play() 호출보다 항상 먼저 적용된다 — 폴링 지연 자체가 없어진다.
        if (typeof window.__paceMuted === 'boolean') { try { list[i].muted = window.__paceMuted; } catch(e2) {} }
      }
    });
    mo0.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch(e) {}
  // 2026-08-15 — 위 MutationObserver는 "새로" 삽입되는 video만 잡는다. TikTok이 기존 <video>
  // 요소를 재사용(같은 엘리먼트를 다음 슬라이드에 재활용)하면 삽입 이벤트가 없어 못 잡는다 — play
  // 이벤트를 캡처 단계(capture: true, 버블링을 안 기다려 가장 먼저 실행)로 문서 전체에 걸어 두 번째
  // 안전망을 둔다. 이것도 500ms 폴링보다 훨씬 빠르다(이벤트 자체가 발화 즉시 동기 실행).
  try {
    document.addEventListener('play', function(ev){
      var t = ev.target;
      if (t && t.tagName === 'VIDEO' && typeof window.__paceMuted === 'boolean' && t.muted !== window.__paceMuted) {
        t.muted = window.__paceMuted;
      }
    }, true);
  } catch(e) {}

  function mainInit() {
  // 🔴 원래 이 함수 아래쪽(구 setInterval 등록부 근처)에 있던 걸 맨 위로 옮김 — hideIconRailAndScaleVideo가
  // mainInit 안에서 직접 한 번 즉시 호출되는데(같은 함수 뒤쪽), signalFsDecidedOnce가 이 값을 그
  // 첫 호출에서부터 정확히 써야 한다(startedAt이 아직 undefined면 Date.now()-startedAt이 NaN이 돼
  // "6.5초 미만" 검사가 항상 통과해버리는 조용한 버그가 생김).
  var startedAt = Date.now();
  send({ type: 'domlog', text: '🟢 mainInit 시작(DOMContentLoaded 기준) t=' + Date.now() + ' path=' + location.pathname });
  // 🔴 2026-08-17(밤 자율 루프, 커버 스피너 영구 재현으로 발견) — 초기 URL은 /foryou지만 틱톡이
  // **루트('/')로 리다이렉트**하는 세션이 있다(데스크톱 For You는 루트에서도 서빙됨). 그때
  // "indexOf('foryou')" 체크 3곳(enforceMainWidth/hideIconRailAndScaleVideo/빈피드 워치독)이 전부
  // 스킵돼 스케일 판단·fsDecided·워치독이 죽고, video의 ready조차 안 가면 RN 10초 안전장치도
  // 무장 안 돼 커버 스피너가 영원히 돈다. 루트도 피드 경로로 인정한다.
  function isFeedPath(){
    try {
      var fp = String(location.pathname || '');
      return fp === '/' || fp === '' || fp.indexOf('foryou') !== -1;
    } catch(eFp) { return false; }
  }
  // /foryou가 아닌 페이지로 넘어가면(사이드바 메뉴 등, 전체 페이지 리로드라 mainInit이 다시 돔)
  // RN이 그리던 아이콘 오버레이(좋아요/댓글/북마크/공유)가 이전 페이지의 카운트를 든 채 그대로
  // 남아있으면 안 된다 — 매 mainInit마다 일단 비우고, /foryou면 hideIconRailAndScaleVideo가
  // 곧 새 값으로 다시 채운다.
  window.__paceLastIconState = null;
  send({ type: 'iconState', like: '', comment: '', favorite: '', share: '', clear: true });
  // 🔴 2026-08-15 사장님 지적("사람아이콘 눌르면 팔로우 화면이 왜 짤려", "세로줄로 메뉴 뜨는거
  // 맞아?") — 2026-08-12 QA_MATRIX에 이미 "알려진 부작용, 후속 작업"으로 기록돼 있던 항목이다:
  // 자동넘김을 살리려고 의도적으로 데스크톱 UA를 쓰는데(위 userAgent prop 주석 참고 — 모바일 UA는
  // 자동넘김이 1회 이동 후 영구 고착됐었다), 그 대가로 틱톡 데스크톱 UI(왼쪽 세로 사이드바 —
  // 추천/탐색/팔로잉/라이브 등)가 그대로 딸려나와 좁은 화면에서 팔로우 같은 하위 페이지가 눌려
  // 잘렸다. 실측(data-e2e 덤프)으로 확정한 컨테이너를 CSS로 숨긴다 — 유튜브 플레이어가 이미 하는
  // 것과 같은 패턴(불필요 UI를 injected CSS로 제거). class 앞부분(css-xxxxxx)은 빌드마다 바뀌는
  // 해시라 *= 부분일치로 뒤쪽 안정적인 컴포넌트명(DivHeaderContainer)만 잡는다.
  // 실측(data-e2e="nav-following" 조상 체인, 2회 시도 끝에 확정)으로 찾은 진짜 사이드바 컨테이너들.
  // DivSideNavContainer=보이는 아이콘 목록, DivSideNavPlaceholderContainer=레이아웃에서 그만큼
  // 폭을 미리 비워두는 자리표시자 — 아이콘만 숨기고 이걸 안 숨기면 빈 공간만 남아 영상이 여전히
  // 안 차므로 둘 다 숨긴다. 1차 시도(DivHeaderContainer, 로고 조상 기준)는 실기기 스크린샷으로
  // 실패 확정됨(로고와 세로 아이콘 목록이 다른 하위트리였다) — 지금 건 실제로 확인된 값.
  // ⚠️ /following 등 하위 화면(팔로우 추천 카드 그리드)이 좁은 화면 왼쪽 절반만 쓰고 나머지가
  // 까맣게 남는 별도 증상도 있다(실측 확인) — DivMainContainer/DivUserListWrapper에 width:100%를
  // 강제해봤지만 실기기/시뮬레이터 재검증 결과 효과 없었다(그리드 트랙이 고정 px로 박혀있을
  // 가능성이 맞았다 — 진짜 원인·수정은 아래 fixNarrowCardGrid() 참고).
  // 🔴 2026-08-15(2차) — 위 클래스명 셀렉터(DivSideNavContainer)는 /foryou·/explore(같은 SPA
  // 라우트)에서만 통했다. /live로 들어가면 완전히 다른 클래스 체계(실측: tiktok-1w5o2is,
  // tiktok-13e8rmi, eyxny660 등 — 뒤에 안정적인 컴포넌트명이 안 붙는 순수 해시라 *= 매칭 자체가
  // 불가능)를 써서 사이드바가 그대로 노출됐다(실기기 확인). "화면 위에 검은 View를 고정폭으로
  // 덮어씌우자"는 대안도 시도했지만 /explore처럼 이미 리플로우가 된 페이지에서 정상 콘텐츠(첫
  // 카테고리 탭)까지 잘라먹는 새 부작용을 냄 — 되돌림. 최종: 클래스명이 아니라 **기하학적
  // 특징**(왼쪽 끝에 붙어있고 화면 세로 대부분을 차지하는 좁은 컬럼)으로 찾아 숨긴다 — /live
  // 실측치(width 72~200px, height 652~812px)와 /foryou의 DivSideNavContainer가 공통으로 갖는
  // 패턴이라 클래스명이 또 바뀌어도 안 깨진다. <video>를 담고 있는 컨테이너는 절대 안 숨기게
  // 방어(실제 영상 컬럼이 우연히 이 기준에 걸리는 사고 방지). mainInit에서 1회 + houseKeeping에서
  // 매 틱(자가치유, SPA 라우트 전환 대응) 둘 다 호출.
  function hideLeftRailByGeometry(){
    try {
      var vh = window.innerHeight || 0;
      if (!vh) return;
      // 🔴 2026-08-16(10차, 실측으로 확정) — 진단 로그로 DivSideNavContainer(실제 보이는 아이콘
      // 목록)가 width=72/left=0/height=812로 기하학적 조건을 전부 만족하는데도, 아래 제네릭
      // querySelectorAll('div') 순회 방식이 왜인지 이 특정 엘리먼트를 지나쳐 형제인
      // DivSideNavPlaceholderContainer(빈 자리표시자)만 숨기고 있었다(정확한 이유 미확정 —
      // querySelectorAll 순회 중 리스트 순서/컴포지션 관련 특이 케이스로 추정). 기하학적 방식에
      // 더 이상 의존하지 않고, 클래스명으로 직접 확실하게 잡는다 — 실측으로 이미 확인된 안정적
      // 선택자라 지난 세션들에서도 이 클래스명 자체는 계속 유지돼왔다(*=로 해시 프리픽스 변화엔
      // 안전).
      var realNavList = document.querySelectorAll('[class*="DivSideNavContainer"]');
      for (var rn2 = 0; rn2 < realNavList.length; rn2++) {
        var realNav = realNavList[rn2];
        if (realNav.querySelector('video')) continue;
        var wasHidden = realNav.style.display === 'none';
        if (!wasHidden) {
          realNav.style.setProperty('display', 'none', 'important');
        }
        // 🔴 임시 진단 — 숨겼는데도 계속 보인다는 재현이 있어, 실제로 적용/유지되는지 매 틱 확인.
        // 스팸 방지로 "상태가 바뀔 때"만(숨김→안숨김 감지 = 리액트가 되돌렸다는 증거) 로그.
        var nowDisplay = getComputedStyle(realNav).display;
        var stateKey = wasHidden ? 'was-hidden' : 'was-visible';
        if (window.__paceNavLastState !== stateKey + ':' + nowDisplay) {
          window.__paceNavLastState = stateKey + ':' + nowDisplay;
          send({ type: 'domlog', text: '🔍SideNav상태 idx=' + rn2 + ' ' + stateKey + ' computedNow=' + nowDisplay + ' inlineNow=' + realNav.style.display });
        }
      }
      var all = document.querySelectorAll('div');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.style && el.style.display === 'none') continue;
        var r = el.getBoundingClientRect();
        if (r.left > 4 || r.width <= 0 || r.width > 220) continue;
        if (r.height < vh * 0.5) continue;
        if (el.querySelector('video')) continue;
        el.style.setProperty('display', 'none', 'important');
        // 🔴 임시 진단 — 콜드 스타트 직후 왼쪽 바가 몇 초간 그대로 남는 재현 확인용. 스켈레톤과
        // 실제 사이드바가 별개 엘리먼트라 매번(클래스별 최대 1회) 남겨서 언제 무엇이 잡히는지 본다.
        var clsKey = (el.className || 'noclass').slice(0, 40);
        window.__paceRailHideLoggedClasses = window.__paceRailHideLoggedClasses || {};
        if (!window.__paceRailHideLoggedClasses[clsKey]) {
          window.__paceRailHideLoggedClasses[clsKey] = true;
          send({ type: 'domlog', text: '🙈사이드바숨김 t=' + Date.now() + ' w=' + r.width.toFixed(0) + ' h=' + r.height.toFixed(0) + ' cls=' + clsKey });
        }
      }
    } catch(eGeo) {}
  }
  hideLeftRailByGeometry();
  // 🔴 2026-08-15(3차) — /following 카드 그리드가 왼쪽 절반만 쓰고 나머지가 까맣게 남는 문제,
  // 실측(팔로우 버튼 조상 체인의 getComputedStyle 덤프)으로 원인 확정: 카드 리스트 컨테이너
  // (MAIN 바로 아래 DIV.ey5qmgg0, 실측 w=420 — 뷰포트 402와 거의 같음, 즉 컨테이너 자체는 이미
  // 전체 폭)의 직계 자식 카드(DIV.ey5qmgg1)가 데스크톱 그리드용 고정 픽셀 폭(실측 w=226)을 그대로
  // 갖고 있다. 420px 컨테이너에 226px 카드는 1개만 들어가고 나머지 194px가 빈 채(까맣게) 남는다 —
  // "그리드"가 아니라 flex-wrap이 1개씩만 줄바꿈한 것. 이전 시도(DivMainContainer/
  // DivUserListWrapper에 width:100%)가 안 먹혔던 이유는 컨테이너가 아니라 **카드 자체의 고정폭**이
  // 원인이었기 때문 — 컨테이너를 아무리 늘려도 카드가 226px를 고집하면 그대로다.
  // 1차 시도: 클래스명 대신 기하학(형제 폭 동일 + 부모의 60%↑)으로 찾아 47% 강제 — 실기기/
  // 시뮬레이터 재검증 결과 안 먹힘(스크린샷 동일) — 카드가 직계 자식이 아니라 한 단계 더 감싸는
  // wrapper 뒤에 있어 조건에 안 걸린 것으로 추정, 되돌림. 2차(현재): 지금 실측으로 확인된 실제
  // 클래스명(ey5qmgg0=행 컨테이너, ey5qmgg1=카드)을 직접 지정 — /live처럼 접미사 없는 순수 해시라
  // 다음 틱톡 배포에서 바뀌면 깨질 수 있음(이미 DivSideNavContainer 등에서 감수 중인 것과 같은
  // 트레이드오프). 행 컨테이너를 grid로 바꾸고 카드 폭을 auto로 풀어 그리드 트랙이 폭을 정하게 한다.
  try {
    var gridFixStyle = document.createElement('style');
    gridFixStyle.textContent =
      '[class*="ey5qmgg0"]{display:grid!important;grid-template-columns:repeat(2,1fr)!important;gap:8px!important}' +
      '[class*="ey5qmgg1"]{width:auto!important;max-width:none!important}';
    (document.head || document.documentElement).appendChild(gridFixStyle);
  } catch(eGridFix) {}
  // 🔴 2026-08-15(6차, 해결) — /foryou 영상이 뷰포트보다 작게 렌더링되며 우측 좋아요/댓글/공유
  // 아이콘 열이 화면 밖으로 잘려 보이던 문제(사장님 지적 "사이드에 메뉴들이 짤려서"). 4~5차
  // (외부 스타일시트, 인라인 style로 width/max-width 강제)는 전부 실패 — 원인을 몰라 엉뚱한
  // 속성을 붙잡고 있었다. 실측(getComputedStyle)으로 진짜 원인 확정: 영상을 감싸는
  // MAIN.er8k1k70에 **min-width:420px**가 걸려있다. CSS 스펙상 min-width는 충돌 시 width/
  // max-width를 항상 이긴다 — 그래서 width만 아무리 !important로 눌러도 min-width가 더 큰 값을
  // 갖고 있으면 렌더링 폭은 절대 안 줄어든다(4~5차가 매번 "인라인엔 값이 들어갔는데 실제 렌더
  // 폭은 그대로"였던 이유). min-width를 0으로 같이 강제하니 즉시 뷰포트에 맞게 줄어듦을
  // 시뮬레이터 스크린샷으로 확인. flex-basis도 함께 지정하는 이유는 MAIN이 flex item이라
  // width만으로는 flex-basis:auto 상태에서 재계산될 수 있어서다.
  function enforceMainWidth(){
    try {
      if (!isFeedPath()) return;
      var vw = window.innerWidth || 0;
      if (!vw) return;
      var v = document.querySelector('video');
      if (!v) return;
      var mainEl = null;
      var walk = v;
      var guard = 0;
      while (walk && guard < 20) {
        if (walk.tagName === 'MAIN') { mainEl = walk; break; }
        walk = walk.parentElement;
        guard++;
      }
      if (!mainEl) return;
      function apply(){
        if (mainEl.style.getPropertyValue('min-width') === '0px') return;
        mainEl.style.setProperty('min-width', '0', 'important');
        mainEl.style.setProperty('flex', '0 1 ' + vw + 'px', 'important');
        mainEl.style.setProperty('flex-basis', vw + 'px', 'important');
        mainEl.style.setProperty('width', vw + 'px', 'important');
        mainEl.style.setProperty('max-width', vw + 'px', 'important');
      }
      apply();
      if (!mainEl.getAttribute('data-pace-width-observed')) {
        mainEl.setAttribute('data-pace-width-observed', '1');
        var mo2 = new MutationObserver(apply);
        mo2.observe(mainEl, { attributes: true, attributeFilter: ['style'] });
      }
    } catch(eMainWidth) {}
  }
  enforceMainWidth();
  // 🔴 2026-08-16(11차) — 세로 레터박싱을 레이아웃 크기 변경(7~9차, 전부 실패: 검은화면/찌그러짐/
  // 인접영상 겹침 — 스크롤 스냅 계산과 충돌)이 아니라 **레이아웃에 안 끼는 시각 효과만으로** 푼다.
  // 실측(data-e2e="like-icon" 조상 체인)으로 페이지 자체 좋아요/댓글/북마크/공유 아이콘 열의 진짜
  // 컨테이너를 확정: SECTION.e12arnib0(video의 SECTION.ezfgn9c0과 형제, 둘 다 DIV.ehcbpkw2의
  // flex row 자식). 이걸 숨기면(RN 오버레이로 재구현 예정) video만 남아 폭 경쟁이 없어지고,
  // 10차(transform:scale, 레이아웃 안전 확인됨)를 다시 켜도 더 이상 아이콘을 밀어낼 걱정이 없다.
  // overflow:visible을 같이 줘서 확대된 영상이 원래 박스 밖으로 클리핑 안 되게 한다(overflow는
  // 그 자체로 레이아웃 크기에 영향 없음 — width/height와 달리 스크롤 스냅 계산과 무관해 안전).
  // 사진 캐러셀(video 없는 피드 아이템) 전용 처리 — 위 hideIconRailAndScaleVideo의 캐러셀 분기에서
  // 호출. 영상 경로와 같은 규칙: 콘텐츠 SECTION을 폭 기준으로 채우고, 페이지 아이콘 열을 숨기고,
  // 이 아이템의 카운트로 RN 오버레이를 갱신하고, 최초 커버 신호(fsDecided)를 보낸다(video가 없으니
  // 재생 준비 게이트는 해당 없음). 재활용 노드 대응 키는 video src 대신 첫 이미지 src.
  function handleActiveCarousel(activeC, vh, vw){
    try {
      var sections = activeC.querySelectorAll('section');
      var contentSec = null, railSec = null;
      for (var si = 0; si < sections.length; si++) {
        if (sections[si].querySelector('[data-e2e="like-icon"]')) { if (!railSec) railSec = sections[si]; }
        else if (!contentSec) contentSec = sections[si];
      }
      if (!contentSec) return;
      var imgEl = contentSec.querySelector('img');
      var ckey = (imgEl && (imgEl.currentSrc || imgEl.src)) || 'carousel';
      var decidedC = contentSec.getAttribute('data-pace-fs-decided');
      if (decidedC && contentSec.getAttribute('data-pace-fs-src') !== ckey) { decidedC = null; }
      if (contentSec.style.getPropertyValue('transform')) {
        contentSec.style.setProperty('transition', 'none', 'important');
        contentSec.style.removeProperty('transform');
      }
      var rc = contentSec.getBoundingClientRect();
      var willC = false, scaleC = 1;
      if (rc.width && rc.width < vw - 1) {
        scaleC = vw / rc.width;
        if (scaleC > 1.01 && scaleC <= 2.6) { willC = true; }
      }
      if (decidedC === 'no') { willC = false; }
      contentSec.setAttribute('data-pace-fs-decided', willC ? 'yes' : 'no');
      contentSec.setAttribute('data-pace-fs-src', ckey);
      if (willC) {
        var dyC = 0;
        try {
          var crC = activeC.getBoundingClientRect();
          dyC = (crC.top + crC.height / 2) - (rc.top + rc.height / 2);
        } catch(eDyC) {}
        contentSec.style.setProperty('transition', 'none', 'important');
        contentSec.style.setProperty('transform', 'translateY(' + dyC.toFixed(1) + 'px) scale(' + scaleC.toFixed(4) + ')', 'important');
        contentSec.style.setProperty('transform-origin', 'center center', 'important');
        contentSec.style.setProperty('position', 'relative', 'important');
        if (lastActiveZTarget && lastActiveZTarget !== contentSec) {
          lastActiveZTarget.style.setProperty('z-index', '1', 'important');
        }
        lastActiveZTarget = contentSec;
        contentSec.style.setProperty('z-index', '999', 'important');
        if (railSec && railSec.style.display !== 'none') {
          railSec.style.setProperty('display', 'none', 'important');
        }
      } else if (railSec && railSec.style.display === 'none') {
        railSec.style.removeProperty('display');
      }
      // RN 오버레이 카운트를 이 캐러셀 아이템의 값으로 갱신 — 이게 없으면 이전 영상 카운트가
      // 그대로 남아 페이지 아이콘과 두 벌로 겹쳐 보인다(이번 버그의 절반).
      var cLikeC = activeC.querySelector('[data-e2e="like-count"]');
      var cCommentC = activeC.querySelector('[data-e2e="comment-count"]');
      var cFavC = activeC.querySelector('[data-e2e="favorite-count"]');
      var cShareC = activeC.querySelector('[data-e2e="share-count"]');
      var iconStateC = {
        like: cLikeC ? cLikeC.textContent.trim() : '',
        comment: cCommentC ? cCommentC.textContent.trim() : '',
        favorite: cFavC ? cFavC.textContent.trim() : '',
        share: cShareC ? cShareC.textContent.trim() : '',
      };
      var iconStateStrC = JSON.stringify(iconStateC);
      if (window.__paceLastIconState !== iconStateStrC) {
        window.__paceLastIconState = iconStateStrC;
        send({ type: 'iconState', like: iconStateC.like, comment: iconStateC.comment, favorite: iconStateC.favorite, share: iconStateC.share });
      }
      if (!window.__paceFsDecidedSent) {
        var navC = document.querySelector('[class*="DivSideNavContainer"]');
        var railVisibleC = false;
        try { railVisibleC = !!(navC && getComputedStyle(navC).display !== 'none'); } catch(eNvC) {}
        if (!railVisibleC) {
          window.__paceFsDecidedSent = true;
          send({ type: 'domlog', text: '🏁 fsDecided 발사(캐러셀) t=' + Date.now() + ' (+' + Math.round((Date.now() - startedAt) / 100) / 10 + 's)' });
          requestAnimationFrame(function(){ requestAnimationFrame(function(){ send({ type: 'fsDecided' }); }); });
        }
      }
    } catch(eCar) {}
  }
  function hideIconRailAndScaleVideo(force){
    try {
      // 🔴 호출 경로가 늘면서(전환 감지·500ms 틱·3s 하우스키핑·ResizeObserver·loadedmetadata)
      // 스크롤 중 이 함수가 프레임마다 겹쳐 돌 수 있게 됐다 — 전체를 120ms 스로틀로 묶어 어떤
      // 조합으로 불려도 초당 최대 ~8회를 넘지 않게 한다(재계산 지연 최대 120ms는 육안 무해).
      // 단 "전환 감지" 호출은 force로 우회 — 여기가 밀리면 새 아이템의 페이지 아이콘 숨김/교체가
      // 스로틀만큼 늦어 "아이콘 보였다 사라짐"이 된다(사장님 재보고로 실측 확인).
      var nowThr = Date.now();
      if (!force && window.__paceHideRanAt && (nowThr - window.__paceHideRanAt) < 120) return;
      window.__paceHideRanAt = nowThr;
      // 🔴 사장님 실기기 지적("처음켤때는 왼쪽에 길게 바가 있고") — 이 함수의 fsDecided 신호는
      // "영상 풀스크린 판단"만 가렸지, 화면에 실제로 보이는 또 다른 문제(틱톡 자체 왼쪽 세로
      // 사이드바 — 로고/검색/홈 아이콘 목록)를 가리는 hideLeftRailByGeometry는 원래 houseKeeping
      // 3초 틱에만 맡겨져 있어 별개로 최대 3초간 노출됐다. 같은 타이밍(mainInit 1회 + 이 함수가
      // 불리는 모든 시점 — houseKeeping 틱 + pollActiveVideo의 즉시 트리거)에 같이 돌려서 fsDecided
      // 신호가 나갈 때 사이드바도 이미 숨겨져 있도록 묶는다. dismissAppBanner는 여기 안 넣는다 —
      // 그건 실제 클릭을 하는 함수라 원래 설계대로(1500/3000ms 지연 + houseKeeping 3초 틱)만 돌게
      // 남겨둔다(더 자주/이르게 클릭을 시도하게 만들면 "검색 후 방금 연 영상이 잠깐 보였다 꺼짐"류
      // 회귀를 다시 낼 위험이 있음 — 과거 기록).
      hideLeftRailByGeometry();
      enforceMainWidth();
      if (!isFeedPath()) {
        // 🔴 사장님 실기기 지적("/following에 지난 영상 카운트가 그대로 떠있다") — /following 등은
        // 전체 페이지 리로드가 아니라 SPA 라우팅이라 mainInit이 다시 안 돌아서, mainInit 안의
        // "페이지 바뀌면 일단 비운다" 클리어가 이 경로에선 한 번도 안 불린다. houseKeeping(3초
        // 마다)에서도 경로를 봐서 /foryou가 아니면 비운다 — 한 번만 보내면 되니 캐시로 스팸 방지.
        if (window.__paceLastIconState !== null) {
          window.__paceLastIconState = null;
          send({ type: 'iconState', like: '', comment: '', favorite: '', share: '', clear: true });
        }
        return;
      }
      // 🔴 2026-08-16(9차, 화면 녹화 프레임+로그 대조로 진짜 원인 확정) — 콜드 스타트 직후 왼쪽
      // 사이드바+레터박싱이 4~8초씩(테스트마다 들쭉날쭉) 그대로 보이던 진짜 원인: dismissAppBanner가
      // 이미 알고 있던 그 "관심사 게이트"(비로그인 게스트에게 뜨는 카테고리 선택 로그인 유도
      // 모달 — 토큰 생성 때문에 최소 6초는 일부러 안 건드리고 기다림, 위 dismissAppBanner 주석
      // 참고)였다. 이 함수는 그 게이트의 존재를 전혀 모른 채 "지금 뷰포트에 겹치는 video"를 찾아
      // 판단해버렸는데, 게이트가 떠 있는 동안은 그 video가 진짜 /foryou 피드 위치에 자리잡기 전
      // 상태라 사이드바도 아직 없고 크기도 안 맞았다. 게이트 문구가 보이는 동안은 판단 자체를
      // 통째로 미룬다(hideLeftRailByGeometry/enforceMainWidth는 위에서 이미 돌았으니 그대로 둠) —
      // 게이트가 dismissAppBanner에 의해 실제로 닫히고 나면 다음 틱에 정상적으로 재시도된다.
      if (gateTextVisible()) return;
      var vh = window.innerHeight || 0;
      var vw = window.innerWidth || 0;
      if (!vh) return;
      // 🔴 11차(3차) — document.querySelector('video')와 기존 getActiveVideo()(.swiper-slide-active
      // 기준) 둘 다 틀렸다: /foryou는 swiper를 안 써서 getActiveVideo()도 결국 querySelector('video')로
      // 폴백돼 같은 문제(실측: r.top=909, 뷰포트 밖 — 프리로드된 다음 영상을 잡고 있었다)가 재현됐다.
      // 진짜 화면에 보이는 video를 뷰포트와의 실제 겹침(rect)으로 직접 찾는다.
      // 🔴 2026-08-17(사장님 스크린샷 "작은화면일때 오버레이 겹치는거") — 틱톡 피드엔 <video>가
      // 아예 없는 **사진 캐러셀 게시물**이 섞여 나온다(좌우 화살표+점 인디케이터). 파이프라인
      // 전체가 video 기준이라 캐러셀 아이템에선 스케일 판단이 안 돌고(작게 유지) 페이지 아이콘도
      // 안 숨겨지며, RN 오버레이는 이전 영상 카운트를 든 채 남아 두 벌이 겹쳐 보였다. 활성
      // 아이템을 video가 아니라 **컨테이너 겹침**으로 먼저 찾고, 그 안에 video가 없으면 캐러셀
      // 전용 경로(폭 채움 스케일 + 아이콘 열 숨김 + 이 아이템의 카운트로 RN 오버레이 갱신)로 처리.
      var allC0 = document.querySelectorAll('[data-e2e="recommend-list-item-container"]');
      var activeC0 = null, bestCOv0 = -1;
      for (var ci0 = 0; ci0 < allC0.length; ci0++) {
        var cr0 = allC0[ci0].getBoundingClientRect();
        var ov0 = Math.min(cr0.bottom, vh) - Math.max(cr0.top, 0);
        if (ov0 > bestCOv0) { bestCOv0 = ov0; activeC0 = allC0[ci0]; }
      }
      if (activeC0 && bestCOv0 > vh * 0.3 && !activeC0.querySelector('video')) {
        // 🔴 처음엔 "영상 아이템도 활성화 직후 잠깐 video가 없더라"는 이유로 600ms 유예를 뒀는데,
        // 30fps 프레임 분석으로 역효과 확정 — 유예 동안 아무 처리도 안 해서 스케일 안 된 원본
        // 레이아웃(좁은 카드+옆 카드 삐져나옴)이 최대 1.3초 그대로 보였다(사장님 "아직도 버벅").
        // video 유무와 무관하게 즉시 폭 채움을 적용한다 — 나중에 video가 붙으면 영상 경로가 같은
        // 수학(scaleW)으로 재판단하므로 시각적 충돌이 없다.
        handleActiveCarousel(activeC0, vh, vw);
        return;
      }
      var vids = document.querySelectorAll('video');
      var v = null, bestOverlap = -1;
      for (var vi = 0; vi < vids.length; vi++) {
        var vr = vids[vi].getBoundingClientRect();
        var overlap = Math.min(vr.bottom, vh) - Math.max(vr.top, 0);
        if (overlap > bestOverlap) { bestOverlap = overlap; v = vids[vi]; }
      }
      if (!v || bestOverlap <= 0) return;
      var container = v.closest ? v.closest('[data-e2e="recommend-list-item-container"]') : null;
      // 🔴 사장님 실기기 지적("하단 글자도 짤리고, 화면 사이즈도 못맞춰?") — 원인: 16:9 가로 영상처럼
      // 스케일을 스킵하는(비표준 비율) 영상에서도 아이콘을 먼저 숨기고 RN 오버레이를 풀스크린 기준
      // 위치에 띄워버려서, 실제로는 작게(letterbox) 남은 원래 영상 위로 오버레이가 엉뚱하게 겹치고
      // 자막과도 부딪혔다. **순서를 바꾼다** — 먼저 이 영상을 풀스크린 처리할지 결정하고, "한다"고
      // 확정된 경우에만 페이지 아이콘을 숨기고 RN 오버레이를 띄운다. 스킵하는 영상은 페이지 자체
      // UI(아이콘·자막 위치 전부 서로 맞게 설계된 원본)를 하나도 안 건드리고 그대로 둔다.
      var videoSection = v, sguard = 0;
      while (videoSection && videoSection.tagName !== 'SECTION' && sguard < 8) {
        videoSection = videoSection.parentElement;
        sguard++;
      }
      var target = videoSection || v;
      // 🔴 사장님 실기기 지적("화면이 계속 사이즈가 변경되는데") — 스케일을 적용하고 나면 target의
      // 실제 렌더 높이가 vh 근처로 바뀌는데, 3초마다 도는 이 함수가 그 이미 커진 값을 "커질 필요
      // 없음"으로 오판해 지웠다 다시 적용하는 걸 반복했다 — "결정은 한 번만"으로 고쳤었다.
      // 🔴 2026-08-16(재확인) — 그런데 "yes"로 결정한 뒤 배율을 그때 값 그대로 고정해뒀더니, 사장님이
      // 실기기에서 위아래로 진짜 몇 px씩(-7~+819, 뷰포트는 812) 잘려 보인다고 재현. 실측으로 원인
      // 확정: 틱톡 페이지가 로드되며 원본 박스 크기가 살짝(618.67→629px) 계속 흔들리는데, 배율을
      // 딱 한 번 계산해서 안 바꾸니 그 사이 어긋난 채로 고정됐었다. **"풀스크린 여부" 결정(yes/no)은
      // 한 번만 하되, "yes"인 경우 배율 자체는 매 틱 새로 측정해 갱신한다** — 재는 순간만 우리
      // transform을 잠깐 지워 진짜 원본 크기를 보고(같은 동기 실행 안에서 바로 다시 적용하므로
      // 화면 깜빡임 없음), 재는 값이 "이미 우리가 키운 값"으로 오염되는 이전 버그를 원천 차단한다.
      // 🔴 2026-08-16(4차, 실기기 로그로 원인 확정) — rAF(매 프레임) 스윕으로도 빠른 연속 스와이프
      // 4번 중 3~4번씩 여전히 놓침(priorVis= 빈 문자열). 속도 문제가 아니었다 — 틱톡이 스크롤 성능을
      // 위해 SECTION/video DOM 노드를 **재활용**한다(가상 리스트 흔한 패턴): 스와이프해도 새 노드가
      // 안 생기고 같은 노드에 새 영상 내용만 갈아끼운다. 그래서 그 노드에 이전 영상 때 찍힌
      // data-pace-fs-decided가 그대로 남아있어 "이미 판단함"으로 오판, 숨기지도 재판단하지도 않고
      // 넘어갔다(오래된 스케일이 적용된 채로 새 영상이 즉시 노출 → "작다가 커짐"으로 보임). video의
      // currentSrc(영상별로 고유)를 같이 저장해뒀다가, 지금 src가 그때 찍어둔 값과 다르면 재활용된
      // 걸로 보고 무조건 미판단 취급한다.
      var vsrc = v.currentSrc || v.src || '';
      var decided = target.getAttribute('data-pace-fs-decided');
      var decidedSrc = target.getAttribute('data-pace-fs-src');
      if (decided && decidedSrc !== vsrc) { decided = null; }
      if (decided === 'no') return;
      // 🔴 실기기 로그로 원인 확정 — transform을 지워도 CSS transition이 걸려있어(추정) 바로 반영이
      // 안 되고, 애니메이션 도중의(예: 813px, 자연크기도 목표크기도 아닌 중간값) rect를 읽고
      // 있었다(로그: 1틱째 정상 판단→2틱째부턴 계속 will=false). transition을 함께 꺼서 스타일
      // 변경이 그 자리에서 즉시(애니메이션 없이) 반영되게 한다.
      if (target.style.getPropertyValue('transform')) {
        target.style.setProperty('transition', 'none', 'important');
        target.style.removeProperty('transform');
      }
      var r = target.getBoundingClientRect();
      var willFullscreen = false;
      var scale = 1;
      if (r.height && r.height < vh - 1) {
        var scaleH = vh / r.height;
        var scaleW = r.width ? vw / r.width : scaleH;
        // 3:4(0.75) 등 9:16과 크게 다른 비율의 영상은 균일(세로 기준) 스케일 시 폭이 뷰포트 밖으로
        // 크게 밀려나 잘려 보인다(실측 확인) — 그 경우 예전엔 스킵했는데, 스킵 상태(작은 화면 +
        // 페이지 아이콘 열 노출)가 바로 사장님이 보던 그 증상이었다(13차, 진짜 스와이프 녹화 프레임
        // 분석으로 확정 — decideVideoOffscreen 쪽 주석 참고). 스킵 대신 가로 폭 기준으로 채운다.
        if (scaleH > 1.01 && scaleH <= 2.2 && scaleH / scaleW <= 1.25) {
          // 2026-08-17(사장님 "왜 하단의 글자가 잘려" → "여전히 잘려") — 세로 채움의 가로 크롭이
          // 캡션(영상 박스 안 오버레이)을 같이 잘랐다. 6% 상한으로도 잘린다는 재보고에 크롭을
          // **0으로 확정**(정확히 폭 맞춤) — 잘릴 수학적 여지 제거. 박스가 이미 풀폭이면 배율
          // 1.0으로 세로 중앙(translateY)만 맞춘다. 위아래 얇은 여백은 검정 배경이라 티 안 남.
          scale = Math.min(scaleH, Math.max(scaleW, 1)); willFullscreen = true;
        } else if (scaleW > 1.01 && scaleW <= 2.6) {
          scale = scaleW; willFullscreen = true;
        }
      }
      // 🔴 사장님 실기기 지적("처음켤때는 왼쪽에 길게 바가...") — fsDecided를 여기(스타일 적용 전)서
      // 바로 보내면, RN이 메시지를 받고 로딩 커버를 걷는 시점이 실제 transform이 화면에 페인트되는
      // 시점보다 빠를 수 있다(시뮬레이터보다 실기기에서 브릿지/페인트 지연이 더 큼 — 시뮬레이터
      // 검증에선 안 잡히고 실기기에서만 재현된 이유). 스타일 변경을 다 끝낸 뒤, rAF 두 번으로 최소
      // 한 프레임 이상 실제로 페인트된 걸 기다렸다가 신호를 보내도록 아래로 옮김(signalFsDecidedOnce).
      // 🔴 2026-08-16(8차, 화면 녹화로 확정) — 콜드 스타트 직후 화면 녹화를 프레임 단위로 보니, 로딩
      // 커버가 걷힌 뒤에도 왼쪽 사이드바 노출+레터박싱된 영상이 최대 7초까지 그대로 보이는 걸 실측.
      // 5초 안전장치(→10초로 늘림, 별개 조치) 때문이 아니라 fsDecided 자체가 "진짜로" 이 시점에
      // 왔다 — 즉 hideIconRailAndScaleVideo가 **진짜 /foryou 피드 영상이 아직 마운트되기 전**(틱톡
      // 자체 관심사 게이트/온보딩성 화면에 뜨는 임시 video 등)에 뭔가를 "영상"으로 찾아 판단해버리고
      // 그걸로 최초 신호를 보낸 것으로 보인다. container(data-e2e="recommend-list-item-container")는
      // 진짜 피드 아이템에서만 존재하는 확실한 표식이다 — 이게 없는 동안은 "아직 진짜 영상이 아님"
      // 으로 보고 최초 신호를 미룬다(로딩 커버를 계속 덮어둠). 이후 다른 데서 container가 없어도
      // 동작하던 폴백 로직(아이콘 검색 등)은 안 건드림 — 오직 "처음 한 번" 신호를 보낼지만 가른다.
      // 🔴 2026-08-16(11차) — container 존재 여부는 "진짜 영상인가"의 간접 신호일 뿐, "왼쪽 사이드바가
      // 실제로 숨겨졌는가"와는 별개다(둘이 항상 같은 타이밍에 해결되지 않는다는 게 반복 재현으로
      // 확인됨). 간접 신호에 기대는 대신, 공개하기 직전 사이드바가 정말 안 보이는 상태인지 직접
      // 확인한다 — 아직 보이면(엘리먼트가 있고 display:none이 아니면) 신호를 미루고 다음 틱에서
      // 다시 시도한다(이 함수 자체가 매 틱 호출되므로 자동 재시도됨).
      function leftRailStillVisible(){
        try {
          var nav = document.querySelector('[class*="DivSideNavContainer"]');
          if (!nav) return false;
          // 인라인이 아니라 computed로 본다 — 12차부터 숨김의 주 경로가 문서 시작 시점의
          // 스타일시트(ensureStaticHideCss)라 인라인 style.display는 비어 있는 게 정상이다.
          return getComputedStyle(nav).display !== 'none';
        } catch(eNavCheck) { return false; }
      }
      function signalFsDecidedOnce(){
        if (window.__paceFsDecidedSent) return;
        if (!container) return;
        if (leftRailStillVisible()) return;
        // 🔴 2026-08-17(사장님 재보고 "전창인 경우 왜 화면이 처음 멈칫하는거 같지") — 지금까지는
        // 스케일 판단만 끝나면 커버를 걷어서, 영상이 아직 버퍼링 중(readyState<3)이면 첫 프레임에
        // 멈춰 있다가 재생이 시작되는 게 "처음 멈칫"으로 보였다. 실제로 프레임이 나오고 있을 때
        // (재생시간이 진행됐거나 최소 HAVE_FUTURE_DATA)만 공개한다 — 이 함수는 매 틱 재시도되므로
        // 준비되는 즉시(보통 1초 미만) 걷힌다.
        try {
          if (v && v.readyState < 3 && !(v.currentTime > 0.05)) return;
        } catch(eRs) {}
        // 🔴 2026-08-16(12차) — 한때 여기 6.5초 하한선이 있었다(세 조건을 다 걸어도 t≈5.8~6초에
        // 2~2.5초짜리 노출 창이 남아서). 13차 실기기 콘솔로 그 창의 실체가 **스켈레톤 사이드바**
        // (DivSkeletonSide — 세 조건 어디에도 안 걸리고 지오메트리 폴링에만 걸려 리액트가 다시
        // 그릴 때마다 재노출)였음이 확정됐고, 지금은 문서 시작 시점 정적 CSS(ensureStaticHideCss)가
        // 스켈레톤까지 원천 차단하므로 하한선은 순수한 인위적 지연이라 제거했다 — 실기기 로딩
        // "겁내 느려"의 우리 쪽 지분이 이 6.5초였다.
        window.__paceFsDecidedSent = true;
        // 실기기 "로딩 겁내 느려" 원인 분해용 상시 진단 — 커버가 실제로 언제 걷히는지 콘솔로 측정.
        send({ type: 'domlog', text: '🏁 fsDecided 발사 t=' + Date.now() + ' (+' + Math.round((Date.now() - startedAt) / 100) / 10 + 's)' });
        requestAnimationFrame(function(){ requestAnimationFrame(function(){ send({ type: 'fsDecided' }); }); });
      }
      target.setAttribute('data-pace-fs-decided', willFullscreen ? 'yes' : 'no');
      target.setAttribute('data-pace-fs-src', vsrc);
      // video 자체에도 같은 값을 찍는다 — sweepHideUndecided(위 BeforeContentLoaded에서 시작하는
      // rAF 루프)가 이 속성이 없거나(또는 src가 달라 재활용으로 판정되거나) 하는 동안만 SECTION에
      // 인라인 visibility:hidden을 걸어둔다. 이 순간(스케일까지 같은 동기 실행 안에서 끝난 뒤) 그
      // 인라인 값을 직접 지워야 실제로 화면에 처음 그려진다 — 속성만 찍는 걸로는 안 풀림(CSS
      // 셀렉터가 아니라 인라인 스타일이라 자동으로 안 없어짐).
      v.setAttribute('data-pace-fs-decided', willFullscreen ? 'yes' : 'no');
      v.setAttribute('data-pace-fs-src', vsrc);
      // decideVideoOffscreen(화면 밖 프리로드 영상 사전 판단)이 자리잡은 뒤로는 아무 데서도
      // visibility:hidden을 걸지 않는다 — 만약을 위한 방어적 제거만 남겨둔다(보통 no-op).
      target.style.removeProperty('visibility');
      if (!willFullscreen) {
        // 🔴 sweepHideUndecided가 "판단 전" 상태에서 이 영상의 아이콘 열까지 미리 display:none으로
        // 숨겨뒀다(위 진단 참고) — 스킵 케이스(willFullscreen=false)로 확정되면 원래 페이지 UI를
        // 그대로 둬야 하므로(사장님이 처음부터 요구한 "스킵 영상은 원본 그대로") 그 숨김을 되돌린다.
        if (container) {
          var likeElSkip = container.querySelector('[data-e2e="like-icon"]');
          if (likeElSkip) {
            var elSkip = likeElSkip, gSkip = 0;
            while (elSkip && gSkip < 10) {
              if (elSkip.tagName === 'SECTION') {
                if (elSkip.style.display === 'none') { elSkip.style.removeProperty('display'); }
                break;
              }
              elSkip = elSkip.parentElement;
              gSkip++;
            }
          }
        }
        if (window.__paceLastIconState !== null) {
          window.__paceLastIconState = null;
          send({ type: 'iconState', like: '', comment: '', favorite: '', share: '', clear: true });
        }
        signalFsDecidedOnce();
        return;
      }
      var likeEl = container ? container.querySelector('[data-e2e="like-icon"]') : document.querySelector('[data-e2e="like-icon"]');
      if (likeEl) {
        var el = likeEl, guard = 0, railSection = null;
        while (el && guard < 10) {
          if (el.tagName === 'SECTION') { railSection = el; break; }
          el = el.parentElement;
          guard++;
        }
        if (railSection && railSection.style.display !== 'none') {
          railSection.style.setProperty('display', 'none', 'important');
        }
      }
      // 숨긴 페이지 아이콘 대신 RN이 그릴 오버레이 버튼용 카운트를 활성 영상 컨테이너에서 읽어
      // 전달한다 — 값이 바뀔 때만 보내 불필요한 postMessage 스팸을 줄인다.
      if (container) {
        var cLike = container.querySelector('[data-e2e="like-count"]');
        var cComment = container.querySelector('[data-e2e="comment-count"]');
        var cFav = container.querySelector('[data-e2e="favorite-count"]');
        var cShare = container.querySelector('[data-e2e="share-count"]');
        var iconState = {
          like: cLike ? cLike.textContent.trim() : '',
          comment: cComment ? cComment.textContent.trim() : '',
          favorite: cFav ? cFav.textContent.trim() : '',
          share: cShare ? cShare.textContent.trim() : '',
        };
        var iconStateStr = JSON.stringify(iconState);
        if (window.__paceLastIconState !== iconStateStr) {
          window.__paceLastIconState = iconStateStr;
          send({ type: 'iconState', like: iconState.like, comment: iconState.comment, favorite: iconState.favorite, share: iconState.share });
        }
      }
      // 8단계까지 조상에 overflow:visible을 걸었더니 사이드바가 다시 노출되는 회귀가 났다(그 위쪽
      // 조상은 사이드바 숨김 로직과 공유되는 상위 구조라 건드리면 안 됨) — video의 직계 SECTION과
      // 그 바로 위 flex 부모(ehcbpkw2) 딱 2단계까지만 좁힌다.
      var el2 = v, guard2 = 0;
      while (el2 && guard2 < 2) {
        if (el2.tagName === 'SECTION' || el2.tagName === 'DIV') {
          el2.style.setProperty('overflow', 'visible', 'important');
        }
        el2 = el2.parentElement;
        guard2++;
      }
      // 🔴 11차(4차) — video 태그 자체에 transform을 걸면 getBoundingClientRect/로그는 정상(적용된
      // 크기/위치)인데 실제 스크린샷엔 전혀 반영 안 됐다(3회 재확인, 매번 동일) — <video>가 하드웨어
      // 디코더 전용 컴포지팅 레이어를 쓰는 WKWebView의 알려진 특성으로 추정(레이아웃 rect는 CSS
      // 값을 그대로 보고하지만 실제 디코딩된 프레임 레이어는 별도 트랙이라 transform이 안 먹힘).
      // video 자체가 아니라 그걸 감싸는 SECTION(비디오 전용 래퍼, 일반 DOM 레이어라 컴포지팅 정상
      // 적용)에 transform을 건다.
      // 세로 중앙 보정(dy) — decideVideoOffscreen 쪽 13차 주석 참고(아이템 컨테이너 중심 기준,
      // 시각 효과만이라 스냅 계산과 무관).
      var dyAct = 0;
      try {
        if (container) {
          var crAct = container.getBoundingClientRect();
          dyAct = (crAct.top + crAct.height / 2) - (r.top + r.height / 2);
        }
      } catch(eDyAct) {}
      target.style.setProperty('transition', 'none', 'important');
      target.style.setProperty('transform', 'translateY(' + dyAct.toFixed(1) + 'px) scale(' + scale.toFixed(4) + ')', 'important');
      target.style.setProperty('transform-origin', 'center center', 'important');
      // 🔴 사장님 지적("하단 자막 잘려보이는데") — 확인해보니 잘린 게 아니라 **인접(다음) 피드
      // 아이템의 내용이 비쳐 보이는 것**이었다. transform은 레이아웃 공간(그 다음 형제가 차지하는
      // 자리)을 안 바꾸고 시각적으로만 그 밖까지 그리는데, 스택 순서(z-index)가 없어 문서 순서상
      // 나중에 오는(아래에 있는) 다음 피드 아이템이 그 위에 그려져 겹치는 부분에서 다음 아이템
      // 내용이 비쳐 보였다. 확대된 영상을 항상 위로 그리도록 강제.
      target.style.setProperty('position', 'relative', 'important');
      // decideVideoOffscreen이 화면 밖 영상들도 미리 스케일해두면서(z-index:1) 동시에 여러 SECTION이
      // 확대돼 있을 수 있다 — "지금 실제로 보이는" 이 target만 최상단이어야 하므로, 직전에 999였던
      // target(있다면, 지금은 더 이상 활성이 아닌 이전 영상)을 낮은 값으로 되돌린 뒤 이걸 999로 올린다.
      if (lastActiveZTarget && lastActiveZTarget !== target) {
        lastActiveZTarget.style.setProperty('z-index', '1', 'important');
      }
      lastActiveZTarget = target;
      target.style.setProperty('z-index', '999', 'important');
      // 🔴 2026-08-17(사장님 재보고 "화면 조정하는 게 보이잖아", 박스 점프 추적으로 정량 확인) —
      // 활성화 뒤 틱톡이 자체 재렌더로 박스 크기를 바꾸면, 500ms 폴링이 뒤늦게 고치는 순간이
      // "조정 점프"로 보였다. ResizeObserver는 레이아웃 변경 후·페인트 전에 콜백이 돌므로 박스가
      // 바뀌는 바로 그 프레임에 배율을 재적용한다 — 어긋난 크기가 화면에 그려질 틈이 없다.
      // transform은 레이아웃 크기를 안 바꿔 자기 재적용으로는 다시 발화하지 않는다(루프 없음).
      if (!target.__paceRO) {
        try {
          target.__paceRO = new ResizeObserver(function(){ try { hideIconRailAndScaleVideo(); } catch(eRoCb) {} });
          target.__paceRO.observe(target);
        } catch(eRo) {}
      }
      signalFsDecidedOnce();
    } catch(eIconScale) {}
  }
  hideIconRailAndScaleVideo();
  // 🔴 2026-08-15(7차, 미해결) — 폭은 고쳤는데 사장님이 실기기 스크린샷으로 재확인("이게 전체창으로
  // 뜬거냐") — 위아래로도 여전히 카드처럼 떠 있다. 실측(getComputedStyle)으로 원인 확정: video를
  // 감싸는 SECTION.ezfgn9c0에 aspect-ratio:9/16(0.5625)이 고정돼 있다(h=619는 min-height가 아니라
  // 이 비율 때문 — 348*16/9=618.67, 정확히 일치). 뷰포트(예: 402x812)가 9:16보다 세로로 더 긴
  // 비율이라 폭 기준 9:16 박스는 절대 뷰포트 전체 높이를 못 채운다. video 자체는 이미
  // object-fit:cover라 박스 비율만 풀면 네이티브 틱톡처럼 크롭해서 꽉 찰 것으로 예상했다.
  // 실제 시도(SECTION에 aspect-ratio:auto+height:100%!important, 부모 flex:1 1 auto 강제)는
  // 시뮬레이터 스크린샷에서 영상이 통째로 안 보이는(검은 화면, 진행바만 움직임) 심각한 회귀를
  // 내서 즉시 되돌림 — 이 체인 어딘가(아마 절대위치 자손들의 컨테이닝 블록 계산)가 height:100%
  // 전파에 더 예민하게 반응하는 것으로 보임. 폭 수정(min-width, 검증됨)만 남기고 높이는 다음
  // 세션 과제로 남긴다 — 다음엔 aspect-ratio만 먼저 단독으로 풀어보고(height:100% 없이) 단계적으로
  // 반응을 확인할 것.
  // 2026-08-13(17차) 실기기 보고 — 사장님이 실제로 확인: "무엇을 시청하고 싶으신가요, 동물/코미디
  // 등 카테고리가 있는 **로그인 유도** 팝업"이다. 관심사 선택이 아니라 비로그인 사용자에게 흔한
  // "Browse as Guest" 류 게이트로 보인다(웹서치로 확인 — TikTok 데스크톱 웹은 이 팝업을 "게스트로
  // 둘러보기" 버튼으로 닫게 해준다). 예전 문구 목록엔 그게 없었다 — 추가.
  // ⚠️ "continue"/"계속하기"는 일부러 안 넣는다 — 로그인 모달 안의 "Continue with Google/Apple"
  // 버튼과도 겹쳐서, 잘못 누르면 OAuth 플로우가 열리는 훨씬 나쁜 상태로 갈 수 있다. "게스트"류
  // 문구만 안전하게 특정해서 매칭한다.
  var SKIP_PHRASES = ['나중에', 'not now', 'maybe later', 'later', '건너뛰기', 'skip', '완료', 'done',
    '닫기', 'close', '괜찮아요', '괜찮습니다', '아니요', '아니오', '선택 안', 'no thanks', "i'll do this later",
    '게스트', 'guest', '둘러보기', '비회원', '로그인 없이', 'without logging',
    // 🔴 13차(실기기 콘솔로 확정) — 기기에서 틱톡이 진짜 피드 대신 "전체 화면에서 시청" 버튼만 있는
    // 프리뷰 상태로 13초를 버텨서(영상은 +2.5s에 이미 재생 중인데 recommend-list-item-container가
    // +13s에야 생김) 로딩이 "겁내 느려" 보였다. 이 버튼을 눌러 프리뷰를 즉시 벗어나게 한다 —
    // 네이티브 전체화면 승격은 이미 3중 차단돼 있어 눌러도 인라인 유지된다.
    '전체 화면에서 시청', 'watch in full screen'];
  function textMatches(txt){
    var lower = txt.toLowerCase();
    for (var i = 0; i < SKIP_PHRASES.length; i++) {
      if (lower.indexOf(SKIP_PHRASES[i].toLowerCase()) !== -1) return true;
    }
    return false;
  }
  // 2026-08-13(18차) 실기기 로그로 확정(추측 아님) — "건너뛰기" 매칭이 실제 로그인 모달이 아니라
  // "콘텐츠 피드로 건너뛰기"라는 **접근성 스킵링크**(스크린리더용, 화면엔 안 보임)를 계속 클릭하고
  // 있었다(3초마다 같은 로그 반복 = 진짜 모달은 그대로 안 닫힘).
  // ⚠️ 2026-08-13(20차) 코드 재검토로 발견(실기기 재현 전에 미리 잡음) — offsetParent===null 체크는
  // "화면에 안 보임"이 아니라 "레이아웃 흐름에서 빠짐"만 뜻한다. position:fixed 요소는 실제로
  // 화면 한가운데 떠 있는 모달이어도 offsetParent가 항상 null이다(스펙) — 로그인 모달이 흔한
  // position:fixed 오버레이라면, 이 체크가 **진짜 모달 버튼까지 전부 "안 보임"으로 오판해서
  // 걸러내고 있었을 수 있다.** getBoundingClientRect + computedStyle로 실제 크기·표시 여부를
  // 직접 확인하는 방식으로 교체 — position 방식과 무관하게 정확하다.
  function isVisible(el){
    try {
      var rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false; // 접근성 전용 1px 텍스트 등은 계속 제외
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) return false;
      return true;
    } catch(e) { return true; }
  }
  function dismissAppBanner(){
    try {
      var candidates = Array.prototype.slice.call(document.querySelectorAll('button, div[role="button"], a, [role="button"]'));
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (!isVisible(el)) continue;
        var txt = (el.textContent || '').trim();
        if (txt && txt.length < 20 && textMatches(txt)) { el.click(); send({ type: 'domlog', text: '배너닫음(텍스트): ' + txt }); return true; }
      }
      // 2026-08-13(19차) 실기기 로그로 확정 — 이 셀렉터도 isVisible 체크가 없어서 화면에 안 보이는
      // 뭔가를 3초마다 계속 클릭만 하고 있었다(진짜 로그인 모달은 안 닫힘). 전부에 가시성 체크.
      // 🔴 2026-08-15 사장님 실기기 재현("검색하고 영상 고르면 잠깐 보였다 꺼짐") — 실기기 로그로
      // 확정: 검색결과에서 영상을 열면(URL은 /video/...로 바뀌지만 검색 패널 DOM은 안 없어짐) 그
      // 검색 패널 소속 "닫기" 버튼이 이 aria-label 셀렉터에 걸려서 하우스키핑이 **우리가 방금 연
      // 영상을 스스로 닫아버렸다**(클릭→그 직후 검색화면으로 돌아간 게 "잠깐 보였다 꺼짐").
      // 1차 시도(현재 URL에 /search 포함 여부로 판단)는 실패 확정 — URL이 이미 /video/...로 바뀐
      // 뒤였다. 대신 후보 자신의 조상 DOM 클래스명에 "search"가 있는지로 직접 걸러낸다(실측 로그로
      // 확정된 진짜 신호 — ancestors=...DivSearch...). 검색 패널 소속이 아닌 진짜 앱설치 배너의
      // 닫기 버튼은 이 필터에 안 걸린다.
      var closeCandidates = document.querySelectorAll('[aria-label="Close"], [aria-label="닫기"], [aria-label="close"], [aria-label*="skip" i], [aria-label*="건너뛰기"]');
      for (var ci = 0; ci < closeCandidates.length; ci++) {
        var cand = closeCandidates[ci];
        if (!isVisible(cand)) continue;
        var isSearchUiChrome = false;
        var ancFilter = cand;
        for (var af = 0; af < 8 && ancFilter; af++) {
          if (/search/i.test(String(ancFilter.className || ''))) { isSearchUiChrome = true; break; }
          ancFilter = ancFilter.parentElement;
        }
        if (isSearchUiChrome) {
          send({ type: 'domlog', text: '배너닫음(aria-label) 건너뜀(검색패널 소속): ' + (cand.getAttribute('aria-label') || '') });
          continue;
        }
        cand.click();
        send({ type: 'domlog', text: '배너닫음(aria-label): ' + (cand.getAttribute('aria-label') || '') });
        return true;
      }
      var bodyText = document.body.innerText || '';
      if (bodyText.indexOf('무엇을 시청하고') !== -1 || bodyText.indexOf('what you') !== -1 || bodyText.indexOf('관심사') !== -1) {
        // 2026-08-13(24차) 웹서치로 확인(추측 아님) — 틱톡의 핑거프린팅 쿠키(msToken/ttwid 등)는
        // 페이지 자체 JS가 시간을 두고 생성한다("세션 생성 뒤 msToken 준비될 때까지 sleep 필요"가
        // 스크래핑 커뮤니티의 실측 관례). 우리가 로드 직후(1.5~3초)에 카테고리+계속을 눌러버리면
        // 그 토큰이 아직 안 만들어진 상태로 다음 영상 요청이 나가 "서버 오류"로 거부됐을 수 있다
        // (실기기 재현: 로그인벽은 통과했는데 그 다음 "영상을 불러올 수 없음"). 페이지 로드 후
        // 최소 6초는 그냥 기다렸다가 게이트를 넘는다 — 그 사이 하우스키핑의 다른 배너닫기는 계속
        // 동작(여긴 이 특정 관심사 게이트 통과 시도만 늦춘다).
        if (Date.now() - startedAt < 6000) {
          send({ type: 'domlog', text: '로그인모달 감지 — 토큰 생성 대기 중(' + Math.round((Date.now() - startedAt) / 1000) + 's)' });
          return false;
        }
        // 2026-08-13(21차) 실기기 콘솔 로그로 실제 버튼 목록을 확인(추측 아님): "계속 (0/3)",
        // "로그인", "대한민국", "서비스 약관", "개인정보 처리방침". "게스트로 보기"류 스킵 버튼은
        // 없다 — 이건 "카테고리를 최소 몇 개 고르면 계속 버튼이 활성화되는" 관심사 선택 게이트다.
        // "계속"만 클릭해선 (0/3)이라 진행이 안 될 수 있다. 모달 컨테이너 안에서 이 5개 알려진
        // 크롬 버튼이 아닌, 텍스트를 가진 "말단"(자식 엘리먼트 없는) 요소들을 카테고리 칩으로 보고
        // 몇 개 클릭한 뒤 "계속"을 누른다. ⚠️ "로그인"/OAuth류는 여전히 안 건드린다.
        try {
          // 2026-08-15 실기기 발견(추측 아님, 로그로 확정) — 이 TreeWalker가 SHOW_TEXT로 body 전체를
          // 훑는데, <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">의 텍스트 콘텐츠(SSR 하이드레이션용
          // JSON, 화면엔 안 보임)도 DOM상 엄연한 텍스트 노드라 같이 걸린다. 이 JSON이 모달 문구를
          // 데이터로도 들고 있어서(다국어 리소스 등) 실제 눈에 보이는 모달보다 먼저(문서상 앞쪽에
          // 있어서) 매칭돼버렸다 — 그 결과 anchor가 <script> 안이라 카테고리 칩이 매번 0개로 나오고
          // 게이트를 영원히 못 넘었다("사용약관"이 뭐냐는 질문도 이 로그인 게이트 자체를 보고 하신
          // 것 — 그 모달 하단 고정 링크 중 하나). script/style/보이지 않는 조상은 걸러내고, 매칭된
          // anchor가 실제로 안 보이면 계속 다음 후보를 찾는다.
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
              var p = node.parentElement;
              while (p) {
                var tag = p.tagName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
                p = p.parentElement;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          });
          var textNode = null;
          while (walker.nextNode()) {
            var cur = walker.currentNode;
            if ((cur.nodeValue || '').indexOf('무엇을 시청하고') !== -1 && cur.parentElement && isVisible(cur.parentElement)) {
              textNode = cur; break;
            }
          }
          var anchor = textNode ? textNode.parentElement : null;
          var modalRoot = null;
          // 2026-08-13(22차) — 이전엔 "버튼 1~14개"인 조상만 인정했는데, 실기기에서 세션마다
          // 모달 DOM 구조가 조금씩 달라(카테고리 칩이 button/a로 렌더될 때도 있는 듯) 그 범위를
          // 못 맞춰 "컨테이너 못 찾음"이 나기도 했다. 버튼 개수로 거르지 말고, "계속"/"로그인"
          // 텍스트를 실제로 포함한 첫 조상을 그대로 모달 루트로 쓴다 — 훨씬 관대하고 목적에 맞다
          // (우리가 찾는 건 "버튼이 적당히 있는 곳"이 아니라 "계속 버튼이 들어있는 곳").
          if (anchor) {
            var level = 0;
            var el2 = anchor;
            while (el2 && level < 8) {
              var txt3 = (el2.textContent || '');
              if (txt3.indexOf('계속') !== -1 || txt3.toLowerCase().indexOf('continue') !== -1) { modalRoot = el2; break; }
              el2 = el2.parentElement;
              level++;
            }
          }
          if (!modalRoot) {
            send({ type: 'domlog', text: '로그인모달 컨테이너 못 찾음(계속 텍스트 없음, anchor=' + (anchor ? anchor.tagName : 'null') + ')' });
          } else {
            var KNOWN_CHROME = ['계속', '로그인', '대한민국', '서비스 약관', '개인정보 처리방침', 'continue', 'log in', 'login'];
            var isKnownChrome = function(t){
              var lt = t.toLowerCase();
              for (var kc = 0; kc < KNOWN_CHROME.length; kc++) { if (lt.indexOf(KNOWN_CHROME[kc].toLowerCase()) !== -1) return true; }
              return false;
            };
            // 2026-08-13(23차) — children.length===0(순수 리프)만 인정했더니 0개였다(실기기 확인) —
            // 아이콘+텍스트를 함께 감싼 카테고리 칩이면 진짜 리프는 아이콘 뒤의 span 하나뿐이고,
            // 우리가 원하는 "칩 전체"는 그 부모일 수 있다. 대신 "자신과 완전히 같은 텍스트를 가진
            // 자손이 없는" 가장 안쪽 요소를 찾는다 — 래퍼 깊이가 몇 겹이든 실제 텍스트가 달린
            // 지점을 정확히 잡아낸다.
            var all = modalRoot.querySelectorAll('*');
            var chipCandidates = [];
            for (var a2 = 0; a2 < all.length; a2++) {
              var cand = all[a2];
              var ctxt = (cand.textContent || '').trim();
              if (!ctxt || ctxt.length > 12) continue; // 카테고리명은 짧다(동물/코미디 등)
              if (isKnownChrome(ctxt)) continue;
              if (!isVisible(cand)) continue;
              var kids2 = cand.querySelectorAll('*');
              var isWrapper = false;
              for (var w2 = 0; w2 < kids2.length; w2++) {
                if ((kids2[w2].textContent || '').trim() === ctxt) { isWrapper = true; break; }
              }
              if (isWrapper) continue;
              chipCandidates.push(cand);
            }
            send({ type: 'domlog', text: '카테고리칩 후보 ' + chipCandidates.length + '개: ' + chipCandidates.slice(0, 8).map(function(c){ return '"' + (c.textContent || '').trim() + '"'; }).join(', ') });
            if (chipCandidates.length === 0) {
              // 그래도 0개면 실제 마크업을 그대로 덤프해서 다음 라운드에 정확히 좁힌다.
              try { send({ type: 'domlog', text: '모달 HTML: ' + modalRoot.outerHTML.slice(0, 500) }); } catch(e) {}
            }
            var clickN = Math.min(3, chipCandidates.length);
            for (var c3 = 0; c3 < clickN; c3++) { try { chipCandidates[c3].click(); } catch(e) {} }
            if (clickN > 0) {
              send({ type: 'domlog', text: '카테고리 ' + clickN + '개 클릭함, 0.4초 뒤 계속 버튼 시도' });
              setTimeout(function(){
                try {
                  var btns2 = modalRoot.querySelectorAll('button, [role="button"], a');
                  for (var b2 = 0; b2 < btns2.length; b2++) {
                    var bt = (btns2[b2].textContent || '').trim();
                    if (isVisible(btns2[b2]) && bt.indexOf('계속') !== -1) { btns2[b2].click(); send({ type: 'domlog', text: '계속 버튼 클릭: ' + bt }); return; }
                  }
                } catch(e) {}
              }, 400);
            }
          }
        } catch(e) { send({ type: 'domlog', text: '로그인모달 진단 실패: ' + e.message }); }
        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); } catch(e) {}
        try { document.body.click(); } catch(e) {}
      }
    } catch(e) {}
    return false;
  }

  function getActiveVideo(){
    var activeSlide = document.querySelector('.swiper-slide-active');
    var v = activeSlide ? activeSlide.querySelector('video') : null;
    if (v) return v;
    // 🔴 2026-08-18 사장님 재현("영상 중간에 혼자 넘어감") — /foryou는 swiper가 없어 여기로 오는데,
    // 예전 폴백(querySelector('video') = DOM 첫 번째 영상)은 **화면 밖 프리로드 영상**을 잡을 수
    // 있었다(과거 조사에서 r.top=909 실측된 그 문제 — 스케일 경로는 고쳤는데 이 종료/진행률 감지
    // 경로만 남아 있었다). 프리로드 영상이 끝나거나 루프백하면 보고 있는 영상이 중간이어도 ended로
    // 오판 → 자동넘김 오발사. 스케일 경로와 동일하게 뷰포트 겹침 최대 영상을 고른다.
    try {
      var vhA = window.innerHeight || 0;
      var vidsA = document.querySelectorAll('video');
      var bestA = null, boA = -1;
      for (var ai = 0; ai < vidsA.length; ai++) {
        var ra = vidsA[ai].getBoundingClientRect();
        var ova = Math.min(ra.bottom, vhA) - Math.max(ra.top, 0);
        if (ova > boA) { boA = ova; bestA = vidsA[ai]; }
      }
      if (bestA && boA > 0) return bestA;
    } catch(eGa) {}
    return document.querySelector('video');
  }
  function markAdvancingOnce(video){
    if (video.__paceAdvancing) return false;
    video.__paceAdvancing = true;
    return true;
  }
  function scrollToNextFromVideo(video){
    try {
      var slide = video.closest ? video.closest('.swiper-slide') : null;
      if (slide && slide.nextElementSibling) {
        slide.nextElementSibling.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        return;
      }
      if (slide) return;
      var e = video;
      while (e && e.tagName && e.tagName.toLowerCase() !== 'body') {
        var next = e.nextElementSibling;
        if (next && e.parentElement && e.parentElement.scrollHeight > e.parentElement.clientHeight) {
          next.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
          return;
        }
        e = e.parentElement;
      }
    } catch(err) {}
  }
  function goToNext(video){
    try {
      var allSwipers = document.querySelectorAll('.swiper');
      for (var s = 0; s < allSwipers.length; s++) {
        var inst = allSwipers[s].swiper;
        if (inst && typeof inst.slideNext === 'function') inst.slideNext();
      }
    } catch(e) {}
    scrollToNextFromVideo(video);
    try {
      var py0 = window.innerHeight * 0.8, py1 = window.innerHeight * 0.15, px = window.innerWidth / 2;
      var pel = document.elementFromPoint(px, py0) || document.body;
      function pev(type, y, id){
        return new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: px, clientY: y, bubbles: true, cancelable: true });
      }
      pel.dispatchEvent(pev('pointerdown', py0, 1));
      pel.dispatchEvent(pev('pointermove', (py0 + py1) / 2, 1));
      pel.dispatchEvent(pev('pointermove', py1, 1));
      pel.dispatchEvent(pev('pointerup', py1, 1));
    } catch(e) {}
    try {
      var my0 = window.innerHeight * 0.8, my1 = window.innerHeight * 0.15, mx = window.innerWidth / 2;
      var mel = document.elementFromPoint(mx, my0) || document.body;
      function mev(type, y){ return new MouseEvent(type, { clientX: mx, clientY: y, bubbles: true, cancelable: true, button: 0 }); }
      mel.dispatchEvent(mev('mousedown', my0));
      mel.dispatchEvent(mev('mousemove', (my0 + my1) / 2));
      mel.dispatchEvent(mev('mousemove', my1));
      mel.dispatchEvent(mev('mouseup', my1));
    } catch(e) {}
    try {
      var y0 = window.innerHeight * 0.8, y1 = window.innerHeight * 0.15, x = window.innerWidth / 2;
      var el = document.elementFromPoint(x, y0) || document.body;
      function tev(type, y){ var t = new Touch({identifier: 1, target: el, clientX: x, clientY: y});
        return new TouchEvent(type, {cancelable: true, bubbles: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t]}); }
      el.dispatchEvent(tev('touchstart', y0));
      el.dispatchEvent(tev('touchmove', (y0 + y1) / 2));
      el.dispatchEvent(tev('touchmove', y1));
      el.dispatchEvent(tev('touchend', y1));
    } catch(e) {}
    try {
      var wheelEl = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) || document.body;
      wheelEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 800, bubbles: true, cancelable: true }));
    } catch(e) {}
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    } catch(e) {}
    try {
      var containers = document.querySelectorAll('div, main, section');
      var candidates = [];
      for (var k = 0; k < containers.length; k++) {
        var c = containers[k];
        var delta = c.scrollHeight - c.clientHeight;
        if (delta > 20) candidates.push({ el: c, top: c.scrollTop });
      }
      for (var m = 0; m < Math.min(3, candidates.length); m++) {
        candidates[m].el.scrollTop = candidates[m].top + window.innerHeight;
      }
      var se0 = document.scrollingElement || document.documentElement;
      se0.scrollTop = se0.scrollTop + window.innerHeight;
    } catch(e) {}
  }
  // 실제로 다음 영상으로 옮겨갔는지 확인하며 최대 6회(≈4.2초) 재시도한다. "영상이 이미 끝났다"고
  // 확정된 뒤에만 도는 재시도라 재생 중에는 절대 안 돈다(구버전의 8초 블라인드 강제루프와 다름).
  function tryAdvance(video, attemptsLeft){
    if (attemptsLeft === undefined) attemptsLeft = 6;
    goToNext(video);
    setTimeout(function(){
      var nowActive = getActiveVideo();
      if (nowActive && nowActive !== video) {
        video.__paceAdvancing = false;
        // 2026-08-15 실기기 발견("FOCUS ON인데 다음 영상으로 안 넘어감", "소리가 나왔다 안
        // 나왔다") — 슬라이드 DOM은 실제로 옮겨갔는데(nowActive가 바뀜) 새 video가 그냥
        // 멈춰 있는 경우가 있었다. 여기까지는 goToNext()의 합성 스크롤/포인터/터치 이벤트가
        // 트리거지, 틱톡 자신의 재생 로직이 항상 같이 따라온다는 보장이 없다 — 그래서
        // 화면상으론 "안 넘어감"(그대로 멈춘 이전 프레임)으로 보이고, 어떤 영상은 재생되고
        // 어떤 건 멈춰만 있으니 "소리가 나왔다 안 나왔다"로 체감된 것도 같은 원인일 수 있다.
        // → 전환 성공을 확인한 시점에 새 video가 paused면 명시적으로 play()를 부른다. 이
        // 시점은 이미 이전의 진짜 사용자 탭으로 페이지 전체가 자동재생 허용을 받은 뒤라
        // (WebKit 자동재생 정책은 엘리먼트가 아니라 페이지/문서 단위) muted 여부와 무관하게
        // 통과할 것으로 기대한다.
        // 2026-08-15 실기기 재보고("소리가 잠깐 나고 안 나는 걸로 바뀜") — 새 video가 자기 자신의
        // 기본 muted 상태(대개 false, 즉 소리 있음)로 재생을 시작해서, RN의 무음스위치 폴링(최대
        // 2초 주기, setMuted 프로퍼티 참고)이 따라잡기 전까지 잠깐 소리가 샜다. window.__paceMuted
        // (RN이 setMuted를 부를 때마다 최신값 저장)를 play() 전에 즉시 적용해 그 틈을 없앤다.
        try {
          ensureInline(nowActive);
          if (typeof window.__paceMuted === 'boolean') nowActive.muted = window.__paceMuted;
          var wasPaused = nowActive.paused;
          if (wasPaused) nowActive.play().catch(function(){});
          send({ type: 'domlog', text: '자동넘김: 전환 성공, wasPaused=' + wasPaused + ' muted=' + nowActive.muted });
        } catch(e2) {}
        return;
      }
      if (attemptsLeft > 0) { tryAdvance(video, attemptsLeft - 1); }
      else {
        video.__paceAdvancing = false;
        // 🔴 2026-09-02 사장님 제보("특정 쇼츠에서 다음으로 안 넘어가고 계속 같은 쇼츠만 반복") —
        // 여기가 그 구조적 원인이었다. markEndedOnce()가 __paceEndedNotified를 **영구 래치**로
        // 세우는데(video 엘리먼트당 1회), 6회 재시도가 전부 실패한 이 경로에서 그 래치를 안 풀었다.
        // 그러면 틱톡이 같은 영상을 되감아 다시 재생해도 그 다음 'ended'가 통째로 삼켜져 RN에
        // 도달하지 않는다 → RN이 advance()를 다시 부를 계기가 영영 없어져 **그 영상에 갇힌다.**
        // 특정 영상에서만 재현되는 이유도 이걸로 설명된다: 합성 스크롤이 안 먹는 영상(전체화면
        // 승격·관심사 게이트 등)에서만 6회가 다 실패하고, 한 번 실패하면 그 뒤로는 재시도 자체가
        // 일어나지 않는다.
        // → 전환에 실패했으면 래치를 되돌린다. 다음 자연종료에서 다시 시도하게 된다(성공 경로는
        //   위에서 return하므로 영향 없고, 재시도 락은 __paceAdvancing이 따로 관리하므로 중복
        //   발사도 안 생긴다).
        video.__paceEndedNotified = false;
        send({ type: 'domlog', text: '자동넘김: 6회 실패 — ended 래치 해제(다음 종료에 재시도)' });
      }
    }, 700);
  }
  // 2026-08-13(25차) 사장님 실기기 지적("포커스 오프인데도 영상이 계속 넘어감") — 유튜브는 FOCUS
  // OFF(isAutoMode=false)일 때 영상이 끝나면 멈추고 사용자를 기다리는데(feed/index.tsx의 onEnded:
  // isAutoMode면 goNext(), 아니면 setStatus('PAUSED')), 틱톡은 그 설정을 아예 모른 채 WebView
  // 안에서 자연종료를 감지하면 무조건 자기가 알아서 다음으로 넘겨버리고 있었다. RN에 "끝났다"고만
  // 알리고(send ended) 실제로 넘길지는 RN이 결정하게 한다 — 유튜브 플레이어와 똑같은 구조.
  // isAutoMode면 goNext()→advance()가 이 WebView의 tryAdvance를 다시 트리거하고(아래
  // window.paceForceAdvance 경로, 기존 그대로 재사용), 아니면 playing=false가 내려와 v.pause()로
  // 실제로 멈춘다. __paceAdvancing(tryAdvance 재시도 락)과는 별개 플래그를 쓴다 — 여기선 "끝남을
  // 이미 RN에 알렸는지"만 추적하고, 실제 이동 시도 여부/락은 paceForceAdvance 쪽이 따로 관리한다.
  function markEndedOnce(video){
    if (video.__paceEndedNotified) return false;
    video.__paceEndedNotified = true;
    return true;
  }
  function hookVideoEnded(video){
    if (!video || video.__paceEndedHooked) return;
    video.__paceEndedHooked = true;
    try { video.loop = false; } catch(e) {}
    video.addEventListener('ended', function(){
      // 🔴 2026-08-18("지금도 막 넘어감") — 이 리스너는 DOM 첫 video(프리로드 포함)에 걸린다.
      // 화면 밖 프리로드 영상의 ended가 그대로 자동넘김을 쏘던 두 번째 발원지 — 활성(뷰포트
      // 겹침 30%+) 영상일 때만 인정한다. getActiveVideo 수정(폴링 경로)과 한 쌍.
      try {
        var reE = video.getBoundingClientRect();
        var vhE = window.innerHeight || 0;
        var ovE = Math.min(reE.bottom, vhE) - Math.max(reE.top, 0);
        if (!vhE || ovE < vhE * 0.3) {
          send({ type: 'domlog', text: '🔚 비활성 영상 ended 무시 top=' + reE.top.toFixed(0) });
          return;
        }
      } catch(eEh) {}
      if (!markEndedOnce(video)) return;
      send({ type: 'domlog', text: '🔚 ended(DOM이벤트) 발사' });
      send({ type: 'ended' });
    }, false);
  }
  var endedObserverStarted = false;
  function startEndedObserver(){
    if (endedObserverStarted) return; endedObserverStarted = true;
    var v0 = document.querySelector('video');
    if (v0) hookVideoEnded(v0);
    var mo = new MutationObserver(function(){
      var v = document.querySelector('video');
      if (v) hookVideoEnded(v);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
  // 폴링 백업 — 'ended'가 안 뜨는 경우(틱톡이 video.loop을 되돌리는 등)를 대비해 재생 위치로
  // 직접 종료를 감지한다(YouTubeShortsPlayer.ios.tsx와 동일 패턴).
  var pollLastT = -1, pollLastVideo = null, pollLastSrc = null;
  // decideVideoOffscreen이 화면 밖 영상들도 미리 스케일해두면서 여러 SECTION이 동시에 z-index를
  // 가질 수 있게 됐다 — "지금 실제로 화면에 보이는 영상"만 항상 최상단(999)이어야 다음 피드
  // 아이템이 비쳐 보이던 예전 버그가 재발하지 않는다. hideIconRailAndScaleVideo가 활성 영상에
  // 999를 줄 때마다 직전에 999였던 target을 여기 기록해뒀다가 낮은 값으로 되돌린다.
  var lastActiveZTarget = null;
  function pollActiveVideo(){
    // sweepHideUndecided는 "지금 활성인 영상"과 무관하게(프리로드된, 아직 화면 밖인 영상 포함)
    // 항상 먼저 돈다 — 활성 영상 못 찾아도(!v로 아래에서 return) 프리로드분은 계속 숨겨둬야 함.
    // 🔴 2026-08-30 제거 — sweepHideUndecided 는 **자체 50ms 인터벌**을 이미 갖고 있다.
    //   여기서 또 부르면 같은 일이 초당 40회 돈다(의도한 20회의 두 배). 각 실행이
    //   querySelectorAll 전체 순회 + 컨테이너마다 중첩 querySelectorAll 이라 싸지 않다.
    //   자체 인터벌만으로 충분하므로 이 호출은 뺀다.
    // 🔴 캐러셀 대응 — 기존 "영상 바뀜" 감지는 video src 기준이라, video가 없는 사진 캐러셀
    // 아이템으로 스와이프해 들어가는 순간을 못 잡았다(이전 영상의 RN 아이콘이 그대로 남아 페이지
    // 아이콘과 겹치는 원인의 나머지 절반). 활성 컨테이너 자체의 교체를 겹침으로 감지해 즉시
    // 클리어+재판단한다.
    try {
      var vhP = window.innerHeight || 0;
      if (vhP) {
        var allCP = document.querySelectorAll('[data-e2e="recommend-list-item-container"]');
        var actCP = null, bestP = -1;
        for (var cp = 0; cp < allCP.length; cp++) {
          var crP = allCP[cp].getBoundingClientRect();
          var ovP = Math.min(crP.bottom, vhP) - Math.max(crP.top, 0);
          if (ovP > bestP) { bestP = ovP; actCP = allCP[cp]; }
        }
        if (actCP && bestP > vhP * 0.3 && actCP !== window.__paceLastActiveC) {
          window.__paceLastActiveC = actCP;
          // 🔴 잔여 멈칫(왕복 20회 중 4회, 300~466ms) 원인 분해용 상시 진단 — 활성화 순간 이 영상이
          // 어떤 상태였는지(버퍼 찼는지/재생 중인지/프리로드 설정)를 찍어 정지 프레임과 대조한다.
          try {
            var vAct = actCP.querySelector('video');
            if (vAct) {
              var bufEnd = 0;
              try { if (vAct.buffered && vAct.buffered.length) bufEnd = vAct.buffered.end(vAct.buffered.length - 1); } catch(eBuf) {}
              send({ type: 'domlog', text: '🎬활성화 rs=' + vAct.readyState + ' ns=' + vAct.networkState + ' buf=' + bufEnd.toFixed(2) + ' ct=' + vAct.currentTime.toFixed(2) + ' paused=' + vAct.paused + ' pre=' + vAct.preload + ' t=' + Date.now() });
            } else {
              send({ type: 'domlog', text: '🎬활성화 video없음(캐러셀?) t=' + Date.now() });
            }
          } catch(eDg) {}
          // 🔴 2026-08-17(사장님 재보고 "아이콘 보였다 사라지고", 12스와이프 중 8회 소멸 실측 —
          // 최대 1초) — "일단 비우고 나중에 채우기"가 깜빡임 그 자체였다. 새 컨테이너의 카운트는
          // 프리로드 시점에 이미 DOM에 있으므로 지금 바로 읽어 **교체**한다. 못 읽은 경우에만
          // 비운다(이전 영상 값이 남는 것보다 빈 게 낫다는 기존 결정 유지).
          try {
            var qLike = actCP.querySelector('[data-e2e="like-count"]');
            var qComment = actCP.querySelector('[data-e2e="comment-count"]');
            var qFav = actCP.querySelector('[data-e2e="favorite-count"]');
            var qShare = actCP.querySelector('[data-e2e="share-count"]');
            var qState = {
              like: qLike ? qLike.textContent.trim() : '',
              comment: qComment ? qComment.textContent.trim() : '',
              favorite: qFav ? qFav.textContent.trim() : '',
              share: qShare ? qShare.textContent.trim() : '',
            };
            if (qState.like || qState.comment || qState.favorite || qState.share) {
              var qStr = JSON.stringify(qState);
              if (window.__paceLastIconState !== qStr) {
                window.__paceLastIconState = qStr;
                send({ type: 'iconState', like: qState.like, comment: qState.comment, favorite: qState.favorite, share: qState.share });
              }
            } else if (window.__paceLastIconState !== null) {
              window.__paceLastIconState = null;
              send({ type: 'iconState', like: '', comment: '', favorite: '', share: '', clear: true });
            }
          } catch(eQi) {}
          try { hideIconRailAndScaleVideo(true); } catch(eCch) {}
        } else if (actCP && !actCP.querySelector('video')) {
          // video 없는 활성 아이템(캐러셀/늦은 장착)은 내용이 바뀌어도 컨테이너 교체 감지에 안
          // 걸리므로 500ms 틱마다 재평가 — video가 늦게 붙는 경우 붙는 즉시 영상 경로로 넘어간다.
          try { hideIconRailAndScaleVideo(true); } catch(eCr2) {}
        }
      }
    } catch(eCP) {}
    // 🔴 2026-08-17(사장님 재보고 "스와이프 후 화면 조정하는 게 보이잖아") — 활성화 뒤 영상
    // 메타데이터가 도착하면 틱톡이 박스 크기를 바꾸는데, 스케일 재계산이 "전환 감지 때+3초
    // 하우스키핑"에만 돌아서 그 사이 어긋난 크기가 보이다가 뒤늦게 맞춰지는 게 "조정되는 장면"
    // 으로 보였다. 매 500ms 틱마다 무조건 재계산한다(함수가 멱등이고 비용은 rect 몇 개 수준 —
    // 박스가 안 바뀌었으면 같은 값 재적용이라 화면 변화 없음).
    try { hideIconRailAndScaleVideo(); } catch(eEvery) {}
    var v = getActiveVideo();
    if (!v) return;
    // 🔴 2026-08-16(5차, 실기기 스크린샷으로 원인 확정) — "영상 바뀜"을 v(DOM 엘리먼트 객체)의
    // 참조 비교(v !== pollLastVideo)로만 판단했는데, 스와이프 전후로 아이콘 카운트가 그대로인
    // 스크린샷을 보고 확정: 틱톡이 <video> 엘리먼트 자체를 재활용한다(SECTION만이 아니라). 같은
    // 객체에 새 영상만 갈아끼우면 참조는 안 바뀌어서 이 블록(즉시 판단 트리거 + 아이콘 클리어)이
    // 아예 안 돈다 — 3초 houseKeeping 틱에만 의존하게 되며 그 사이 이전 아이콘이 그대로 남는다.
    // src(영상별 고유)로 바뀜을 판단해야 재활용 노드에서도 정확히 잡힌다.
    var vsrc0 = v.currentSrc || v.src || '';
    if (v !== pollLastVideo || vsrc0 !== pollLastSrc) {
      pollLastVideo = v; pollLastSrc = vsrc0; pollLastT = -1;
      // 🔴 사장님 지적("스와이프 하면 까만화면에 오른쪽 아이콘 나왔다가 전체화면") — 영상은 숨겼는데
      // (sweepHideUndecided) RN이 그리는 좋아요/댓글/북마크/공유 오버레이는 *이전* 영상 값을 그대로
      // 들고 있어서, "검정 화면 + 이전 영상 아이콘"이 잠깐 보이다 새 iconState가 도착하면 아이콘도
      // 같이 갱신되는 게 "아이콘 먼저 나왔다 화면 나옴"으로 보였다. 활성 영상이 바뀐 걸 감지한
      // 바로 이 시점에 아이콘도 같이 비워서, 검정 화면일 땐 아이콘도 같이 없게 만든다(둘 다 새
      // 판단이 끝나야 같이 나타남). sweepHideUndecided는 프리로드된(아직 활성 아닌) 영상까지
      // 훑으므로 거기서 clear를 보내면 지금 보고 있는 활성 영상의 아이콘을 잘못 지울 위험이 있어
      // 반드시 "활성 영상이 바뀐" 이 지점에서만 보낸다.
      // 🔴 "아이콘 보였다 사라짐" 수정(컨테이너 교체 감지 쪽과 동일) — 비우기 전에 새 값을 즉시
      // 읽어 교체 시도, 못 읽으면 비움.
      try {
        var cSw = v.closest ? v.closest('[data-e2e="recommend-list-item-container"]') : null;
        var swLike = cSw ? cSw.querySelector('[data-e2e="like-count"]') : null;
        var swComment = cSw ? cSw.querySelector('[data-e2e="comment-count"]') : null;
        var swFav = cSw ? cSw.querySelector('[data-e2e="favorite-count"]') : null;
        var swShare = cSw ? cSw.querySelector('[data-e2e="share-count"]') : null;
        var swState = {
          like: swLike ? swLike.textContent.trim() : '',
          comment: swComment ? swComment.textContent.trim() : '',
          favorite: swFav ? swFav.textContent.trim() : '',
          share: swShare ? swShare.textContent.trim() : '',
        };
        if (swState.like || swState.comment || swState.favorite || swState.share) {
          var swStr = JSON.stringify(swState);
          if (window.__paceLastIconState !== swStr) {
            window.__paceLastIconState = swStr;
            send({ type: 'iconState', like: swState.like, comment: swState.comment, favorite: swState.favorite, share: swState.share });
          }
        } else if (window.__paceLastIconState !== null) {
          window.__paceLastIconState = null;
          send({ type: 'iconState', like: '', comment: '', favorite: '', share: '', clear: true });
        }
      } catch(eSwIc) {}
      // 🔴 사장님 지적("아직도 세로 바가 잠깐보이는현상있어") — fsDecided 커버는 앱을 처음 켤 때
      // 딱 한 번만 통과하는 관문이라 스와이프로 다음 영상 넘어갈 때는 안 걸린다. 그 판단(풀스크린
      // 여부+스케일)이 houseKeeping의 3초 틱에만 맡겨져 있어서, 새 영상이 원래(레터박싱) 크기로
      // 최대 3초간 보이다 갑자기 커지는 게 매 스와이프마다 "바가 나타났다 사라지는" 걸로 보였다.
      // 여기(500ms 폴링, 영상 전환 감지 시점)서 즉시 판단을 돌려 그 창을 3000ms→최대 500ms로 줄인다.
      try { hideIconRailAndScaleVideo(true); } catch(eSwap) {}
    }
    try { if (v.loop) v.loop = false; } catch(e) {}
    // 2026-08-15 사장님 실기기 지적("틱톡 소리 안나다 한번씩 소리나던데 간헐적으로") — tryAdvance의
    // "전환 확인 후 window.__paceMuted 적용"(위 452줄)만으론 안 됐다. 그 확인은 goToNext() 뒤
    // 첫 폴링 틱(700ms)에야 도는데, 그 전에 새 video가 TikTok 자체 기본 상태(대개 muted=false)로
    // 이미 재생을 시작해버리면 그 700ms(최악 재시도 누적 시 최대 4.2초) 동안 소리가 샌다 — 유튜브
    // 스와이프 모드에 있던 "500ms 안전망"이 틱톡엔 없었다(이 폴링은 진행률/종료 감지만 했음). 이미
    // 500ms마다 도는 이 함수에 강제도 얹어 새는 창을 최대 500ms로 좁힌다.
    if (typeof window.__paceMuted === 'boolean' && v.muted !== window.__paceMuted) {
      send({ type: 'domlog', text: '무음안전망(500ms): muted ' + v.muted + '→' + window.__paceMuted + '로 보정' });
      v.muted = window.__paceMuted;
    }
    if (v.readyState >= 2 && !v.__paceReadySent) { v.__paceReadySent = true; send({ type: 'ready' }); }
    if (!v.duration || isNaN(v.duration)) return;
    var t = v.currentTime;
    // 🔴 2026-08-30 — 이 틱은 50ms 라 progress 가 **초당 20회** 브리지를 건넜다(JSON.stringify +
    //   postMessage + RN 쪽 parse). 다른 플레이어 셋은 전부 500ms 다. 소비자(handleProgress)는
    //   에러 카운터만 리셋하므로 20개 중 19개가 순수 낭비였다. 같은 500ms 로 맞춘다.
    if (v.duration > 0 && Date.now() - (window.__paceLastProgAt || 0) >= 500) {
      window.__paceLastProgAt = Date.now();
      send({ type: 'progress', value: t / v.duration });
    }
    var nearEnd = t >= v.duration - 0.5;
    var loopedBack = pollLastT > 1 && t < pollLastT - 1;
    if ((nearEnd || loopedBack) && markEndedOnce(v)) {
      // 🔴 중간 넘김 채증(2026-08-18) — 어떤 조건이, 어느 영상(뷰포트 위치)에서 발사됐는지 상시 기록.
      try {
        var rEd = v.getBoundingClientRect();
        send({ type: 'domlog', text: '🔚 ended판정 near=' + nearEnd + ' loop=' + loopedBack + ' t=' + t.toFixed(1) + ' dur=' + (v.duration || 0).toFixed(1) + ' lastT=' + pollLastT.toFixed(1) + ' top=' + rEd.top.toFixed(0) });
      } catch(eEd) {}
      send({ type: 'ended' });
    }
    pollLastT = t;
  }

  var domDumped = false;
  function dumpDomOnce(){
    if (domDumped) return; domDumped = true;
    try {
      var all = document.querySelectorAll('button, [role="button"], [aria-label]');
      var found = [];
      for (var i = 0; i < all.length && found.length < 15; i++) {
        var el = all[i];
        var label = el.getAttribute('aria-label') || '';
        if (label) found.push(label);
      }
      send({ type: 'domlog', text: 'DOM(' + found.length + '): ' + found.join(' | ').slice(0, 300) });
    } catch(e) {}
  }

  // 2026-08-14(26차) — 사장님 실기기 재현: 로그인 모달은 안 뜨는데(우리 진단이 못 잡음) 틱톡이
  // "영상을 불러올 수 없음"/"서버 오류"를 보여줌. 이게 정확히 어떤 문구·버튼으로 나오는지 아직
  // 한 번도 캡처 못 했다 — 진단으로 한 번만 잡는다(클릭은 안 함, 순수 관측).
  var errorStateDumped = false;
  function dumpErrorStateOnce(){
    if (errorStateDumped) return;
    try {
      var bt = document.body.innerText || '';
      var markers = ['불러올 수 없', '서버 오류', '오류가 발생', '다시 시도', 'something went wrong', "couldn't load", 'error occurred'];
      for (var i = 0; i < markers.length; i++) {
        if (bt.toLowerCase().indexOf(markers[i].toLowerCase()) !== -1) {
          errorStateDumped = true;
          var idx = bt.toLowerCase().indexOf(markers[i].toLowerCase());
          send({ type: 'domlog', text: '🔴 에러상태 감지("' + markers[i] + '"): ' + bt.slice(Math.max(0, idx - 40), idx + 80).replace(/\\n/g, ' ') });
          var btns = document.querySelectorAll('button, [role="button"], a');
          var found = [];
          for (var j = 0; j < btns.length && found.length < 8; j++) {
            if (!isVisible(btns[j])) continue;
            var t2 = (btns[j].textContent || '').trim();
            if (t2) found.push('"' + t2.slice(0, 20) + '"');
          }
          send({ type: 'domlog', text: '에러상태 버튼: ' + found.join(', ') });
          return;
        }
      }
    } catch(e) {}
  }

  function houseKeeping(){
    // 🔴 2026-08-17(밤 자율 루프 6회차, 콜드 스타트 3연속 샘플링으로 재현) — 틱톡이 간헐적으로
    // **빈 페이지**(video 0개, 버튼 0개 — DOM(0), 자체 스피너만 도는 상태, 연속 재시작 레이트리밋
    // 정황)를 주면 fsDecided가 영영 안 나가고 우리 쪽엔 아무 복구 경로가 없었다 — 사장님의 "로딩만
    // 계속 돎"의 한 갈래. video가 한 번도 안 나타난 채 7틱(~21초)이 지나면 빈 피드로 보고 리로드
    // 한다(최대 2회 — 리로드하면 window가 리셋되므로 횟수는 sessionStorage로 유지, 성공적으로
    // video를 보면 해제).
    try {
      if (isFeedPath()) {
        if (document.querySelector('video')) {
          window.__paceVideoEverSeen = true;
          try { sessionStorage.removeItem('paceEmptyReloads'); } catch(eWdS) {}
        } else if (!window.__paceVideoEverSeen) {
          window.__paceEmptyTicks = (window.__paceEmptyTicks || 0) + 1;
          // 2026-08-19 사장님("틱톡 첫 로딩 겁내 느린 거 안 잡아") — 빈 피드 대기 7틱(21s)→3틱(9s).
          // 정상 로드는 3~5초 안에 video가 붙으므로 9초면 실패 확정으로 충분, 회복이 12초 빨라진다.
          if (window.__paceEmptyTicks >= 3) {
            var wdN = 0;
            try { wdN = parseInt(sessionStorage.getItem('paceEmptyReloads') || '0', 10) || 0; } catch(eWdG) {}
            if (wdN < 2) {
              try { sessionStorage.setItem('paceEmptyReloads', String(wdN + 1)); } catch(eWdP) {}
              send({ type: 'domlog', text: '🔄 빈 피드 워치독: video 0개 ' + (window.__paceEmptyTicks * 3) + 's — 리로드 ' + (wdN + 1) + '/2' });
              location.reload();
              return;
            }
          }
        }
      }
    } catch(eWd) {}
    // 🔴 2026-08-17(사장님 "그래도 자연스럽지 않은데 멈칫하면서") — 이 3초 틱이 매번 무거운 DOM
    // 스캔 3개를 돌렸다: dismissAppBanner(전체 버튼+rect), hideLeftRailByGeometry(전체 div+rect),
    // dumpErrorStateOnce(전체 innerText 직렬화 — 에러가 안 걸리는 한 매 틱 반복). 스와이프가 이
    // 3초 스파이크와 겹치면 불규칙 멈칫이 된다. 피드가 안정된 뒤(fsDecided 후 60초 경과)에는
    // 배너 스캔 9초/지오메트리·에러 스캔 15초로 감속 — 초기 게이트/배너 대응 속도는 유지.
    window.__paceHkTick = (window.__paceHkTick || 0) + 1;
    var hkSteady = window.__paceFsDecidedSent && (Date.now() - startedAt) > 60000;
    if (!hkSteady || window.__paceHkTick % 3 === 0) { dismissAppBanner(); }
    if (!hkSteady || window.__paceHkTick % 5 === 0) { hideLeftRailByGeometry(); }
    enforceMainWidth();
    hideIconRailAndScaleVideo();
    dumpDomOnce();
    if (!hkSteady || window.__paceHkTick % 5 === 0) { dumpErrorStateOnce(); }
    var href = '' + location.href;
    // ⚠️ 2026-08-13(20차) 코드 재검토로 발견 — search()가 /search?q=…로 이동시키면 그 결과 페이지는
    // 보통 썸네일 그리드라 자동재생 <video>가 없는 게 정상이다. 이 novideo 체크가 그걸 "재생 실패"로
    // 오판해 12초 뒤 onError(-2)를 보내고, feed/index.tsx의 handlePlayerError가 연속 6회로 세는
    // death-spiral 카운터를 매 사이클(3초 하우스키핑 반복 무관 — 1회만 보내지만)마다 결국 채워서
    // "Shorts를 불러오지 못했습니다" 화면을 띄울 수 있었다. 검색 결과 페이지에선 이 체크를 안 한다.
    var onSearchPage = href.indexOf('/search') !== -1;
    var noVideo = !document.querySelector('video');
    // ⚠️ 2026-09-02 되돌림 — 이 래치를 "한 번 서면 안 풀리는 버그"로 보고 재무장시켰다가
    //   사장님 실기기에서 **"틱톡 실행 중 문제가 발생했습니다"**를 만들었다. 마운트당 1회는
    //   실수가 아니라 바로 위 20차 주석이 설명하는 **의도적 방어**다: novideo 는 onError(-2) 로
    //   가고, feed/index.tsx 의 handlePlayerError 가 그걸 연속 6회 세면 death-spiral 로 판단해
    //   "쇼츠를 불러오지 못했습니다" 화면을 띄운다. 12초마다 재신고하게 만들면 72초면 그 화면이
    //   뜬다 — 내가 정확히 그 경로를 되살렸다.
    //   재신고가 필요하다면 onError 로 보내는 대신 **에러 카운터를 건드리지 않는 별도 신호**로
    //   분리해야 한다. 그 설계 없이 래치만 푸는 것은 회귀다.
    if (!onSearchPage && noVideo && (Date.now() - startedAt) > 12000 && !window.__paceNoVideoSent) {
      window.__paceNoVideoSent = true;
      send({ type: 'novideo', href: href.slice(0, 80) });
    }
  }

  // BT 리모컨/손짓(hands-free) 입력에서 RN이 강제로 "다음 영상" 시도를 걸 수 있게 노출.
  // 자연종료 감지(ended/폴링)와 똑같이 markAdvancingOnce 게이트를 거쳐 tryAdvance를 부른다 —
  // 이미 재생 중인 영상이면(자연종료 아님) 그냥 넘겨버리는 게 아니라 시도만 트리거하고, 이미
  // 진행 중인 이동이 있으면(markAdvancingOnce가 false) 중복 실행하지 않는다.
  window.paceForceAdvance = function(){
    // 2026-08-25 — 유튜브 플레이어와 동일한 실행시점 게이트(헬스장 "밀렸다 한번에 5개" 방지).
    // markAdvancingOnce는 같은 video 기준이라 전환이 완료된 뒤 flush되는 두 번째 묶음을 못 막는다.
    var now = Date.now();
    if (window.__paceAdvGateT && now - window.__paceAdvGateT < 450) { send({ type: 'advdrop' }); return; }
    window.__paceAdvGateT = now;
    var v = getActiveVideo();
    // 🔴 2026-08-27 관측 사각 계기판 — "발화는 오는데 틱톡이 안 넘어감" 판정용: 명령이 어디서 죽는지
    // (활성 비디오 없음 / 이미 진행 중 / tryAdvance 진입)와 0.9s 뒤 실제로 넘어갔는지를 보고한다.
    if (!v) { send({ type: 'ttadv', st: 'novideo' }); return; }
    if (!markAdvancingOnce(v)) { send({ type: 'ttadv', st: 'busy' }); return; }
    var beforeSrc = ('' + (v.currentSrc || v.src || '')).slice(-40);
    send({ type: 'ttadv', st: 'try' });
    tryAdvance(v);
    setTimeout(function () {
      try {
        var v2 = getActiveVideo();
        var afterSrc = v2 ? ('' + (v2.currentSrc || v2.src || '')).slice(-40) : 'none';
        send({ type: 'ttadv', st: afterSrc !== beforeSrc ? 'moved' : 'stuck', t: v2 ? Math.round(v2.currentTime * 10) / 10 : -1 });
      } catch (e) {}
    }, 900);
  };
  // 2026-08-15 — "현재 영상 즐겨찾기 추가"(iOS는 useShortsQueueStore.current로 읽던 유튜브 전용
  // 경로라 틱톡에선 vid가 항상 null이라 조용히 아무 일도 안 났다. 안드는 extractTikTokVideo로
  // 자체 해결했지만(캡처 액티비티가 접근성 트리에서 URL을 긁음), iOS는 그 경로 자체가 없다 — 여기,
  // 우리가 이미 "지금 보이는 video"를 알고 있는 WebView 안에서 직접 permalink를 찾는 게 가장
  // 정확하다. 틱톡 영상 카드엔 정식 공유 링크(/@user/video/1234...)가 DOM 어딘가(공유 버튼 data,
  // 혹은 슬라이드 안 앵커)에 항상 박혀 있다 — 활성 video의 조상을 슬라이드 경계까지 올라가며 그
  // 패턴의 <a href>를 찾는다. RN이 injectJavaScript로 이걸 부르고 postMessage로 결과를 돌려받는
  // 요청/응답 구조(paceForceAdvance와 달리 값을 되돌려줘야 해서 별도 메시지 타입 필요).
  window.paceGetCurrentVideoUrl = function(){
    try {
      var v = getActiveVideo();
      if (!v) { send({ type: 'currentVideoUrl', url: null }); return; }
      // ⚠️ 이 파일 전체가 큰 템플릿 리터럴 문자열이라(INJECTED_JS_BEFORE_LOAD), 정규식 안의 백슬래시
      // escape는 반드시 두 배로 써야 살아남는다 — 한 배로 쓰면 템플릿 리터럴이 "인식 못하는 이스케이프
      // 시퀀스"로 보고 백슬래시를 조용히 삭제해 정규식이 깨진다. 이 주석 안에도 실제 백슬래시 시퀀스를
      // 예시로 적으면 안 된다(주석도 같은 문자열의 일부라 똑같이 잘려나간다 — 직접 겪은 버그).
      // 앞서 다른 곳(에러상태 문자열 개행 제거)에서 못 잡았던 나머지 인스턴스를 여기서 전수 수정.
      var VIDEO_LINK_RE = /\\/@[\\w.-]+\\/video\\/\\d+/;
      function findIn(root){
        if (!root || !root.querySelectorAll) return null;
        var links = root.querySelectorAll('a[href*="/video/"]');
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href') || '';
          if (VIDEO_LINK_RE.test(href)) return href.indexOf('http') === 0 ? href : ('https://www.tiktok.com' + href);
        }
        return null;
      }
      // 2026-08-15(3차) — 실기기+시뮬레이터 둘 다로 확정: 틱톡 "추천" 피드는 슬라이드 안에 <video>
      // 하나뿐이고 그 어디에도 /video/ 링크 자체가 없다(진단 덤프로 실물 확인). 대신 data-e2e 훅
      // 목록에 recommend-list-item-container(컨테이너)/video-author-avatar(작성자)가 실존한다 —
      // 이 컨테이너의 id가 곧 영상의 숫자 ID라는 게 TikTok 웹의 잘 알려진 DOM 패턴이라, 그걸로
      // 작성자 링크와 조합해 정식 permalink를 재구성한다. 못 맞으면(구조 변경 등) 아래에서 여전히
      // 진단 로그를 남긴다.
      // 2026-08-15(4차, 실기기+시뮬레이터 진단으로 확정) — container.id는 "one-column-item-0"
      // 같은 화면상 순번이지 영상 숫자ID가 아니었다(잘 알려진 패턴이라던 가정이 틀림, 실물 덤프로
      // 확인). 대신 작성자 링크(href="/@username")는 확실히 뽑힌다 — 그 username으로 SSR
      // 하이드레이션 JSON(__UNIVERSAL_DATA_FOR_REHYDRATION__, 로그인게이트 조사 때 이미 실존 확인한
      // 그 script 태그)을 훑어 author.uniqueId가 같은 아이템을 찾아 진짜 id를 가져온다 — 정확한
      // JSON 경로를 모르니 구조를 안 타고 값 자체로 재귀 탐색(구조가 바뀌어도 덜 깨지게).
      function findVideoIdByUsername(username){
        try {
          var script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
          if (!script) return null;
          var data = JSON.parse(script.textContent || script.innerText || '{}');
          var found2 = null;
          var seen = [];
          function walk(node, depth){
            if (found2 || !node || typeof node !== 'object' || depth > 12 || seen.indexOf(node) !== -1) return;
            seen.push(node);
            if (node.author && (node.author.uniqueId === username) && node.id && /^\\d+$/.test(String(node.id))) {
              found2 = String(node.id);
              return;
            }
            for (var key in node) {
              if (found2) return;
              walk(node[key], depth + 1);
            }
          }
          walk(data, 0);
          return found2;
        } catch(eJ) { return null; }
      }
      function findByContainerId(){
        var container = v.closest ? v.closest('[data-e2e="recommend-list-item-container"]') : null;
        if (!container) return null;
        var authorWrap = container.querySelector('[data-e2e="video-author-avatar"]');
        var username = null;
        if (authorWrap) {
          var a = authorWrap.tagName === 'A' ? authorWrap : authorWrap.querySelector('a');
          var href = a ? a.getAttribute('href') : null;
          var m = href ? href.match(/\\/@([\\w.-]+)/) : null;
          if (m) username = m[1];
          if (!username) {
            var img = authorWrap.querySelector('img');
            var alt = img ? (img.getAttribute('alt') || '') : '';
            var m2 = alt.match(/@([\\w.-]+)/);
            if (m2) username = m2[1];
          }
        }
        if (!username) return null;
        var vid = findVideoIdByUsername(username);
        if (!vid) return null;
        return 'https://www.tiktok.com/@' + username + '/video/' + vid;
      }
      var found = null;
      try { found = findByContainerId(); } catch(eC) {}
      // 슬라이드 경계(있으면)까지만 올라간다 — 그 밖(사이드바 등)의 다른 영상 링크를 잘못 줍지 않게.
      var slide = v.closest ? v.closest('.swiper-slide') : null;
      if (!found) { try { found = findIn(slide) || findIn(v.parentElement) || findIn(v.closest ? v.closest('article') : null) || findIn(document.body); } catch(e0) {} }
      // 2026-08-15 진단(실기기+시뮬레이터 재현: getCurrentVideoUrl이 항상 null) — <a href> 방식이
      // 실제 DOM에서 안 잡힌다. SPA가 흔히 갱신하는 og:url/canonical 메타도 같이 시도, 그래도
      // 없으면 실제 DOM이 어떻게 생겼는지 직접 덤프한다(추측 그만하고 실물을 본다).
      if (!found) {
        try {
          var og = document.querySelector('meta[property="og:url"]');
          var canon = document.querySelector('link[rel="canonical"]');
          var metaUrl = (og && og.getAttribute('content')) || (canon && canon.getAttribute('href')) || null;
          if (metaUrl && VIDEO_LINK_RE.test(metaUrl)) found = metaUrl;
        } catch(e1) {}
      }
      if (!found) {
        try {
          var anyVideoLinks = document.querySelectorAll('a[href*="/video/"]');
          send({ type: 'domlog', text: '즐겨찾기: URL못찾음. loc=' + location.href + ' /video/링크=' + anyVideoLinks.length });
        } catch(e2) {}
        try {
          var dbgContainer = v.closest ? v.closest('[data-e2e="recommend-list-item-container"]') : null;
          var dbgAuthor = dbgContainer ? dbgContainer.querySelector('[data-e2e="video-author-avatar"]') : null;
          send({ type: 'domlog', text: '즐겨찾기: container.id=' + (dbgContainer ? dbgContainer.id : 'null') + ' authorHTML(300)=' + (dbgAuthor ? dbgAuthor.outerHTML.slice(0, 300) : 'null') });
        } catch(e6) {}
        // 2026-08-15(2차) — 슬라이드 안엔 <video> 하나뿐이라 링크 방식 자체가 안 통한다는 걸
        // 확인했다(700자 덤프로 실물 확인). 링크가 아니라 data-e2e 훅(틱톡이 자동화테스트/분석용으로
        // 붙이는 안정적 속성)을 뒤져서 실제로 뭐가 있는지 목록화 — 다음 라운드에 정확한 셀렉터를
        // 잡기 위한 정찰. 어떤 값이 실존하는지 전혀 모르니 값 자체를 그대로 로그로 남긴다.
        try {
          var e2eEls = document.querySelectorAll('[data-e2e]');
          var e2eVals = [];
          for (var q = 0; q < e2eEls.length && e2eVals.length < 40; q++) {
            var val = e2eEls[q].getAttribute('data-e2e');
            if (val && e2eVals.indexOf(val) === -1) e2eVals.push(val);
          }
          send({ type: 'domlog', text: '즐겨찾기: data-e2e 목록(' + e2eVals.length + '): ' + e2eVals.join(', ') });
        } catch(e5) {}
        try {
          var dumpRoot = slide || v.parentElement || document.body;
          // 부모로 3단계 더 올라가 액션바(좋아요/댓글/공유/유저명)가 포함될 만한 범위로 넓힌다.
          for (var up = 0; up < 3 && dumpRoot.parentElement; up++) dumpRoot = dumpRoot.parentElement;
          send({ type: 'domlog', text: '즐겨찾기: 슬라이드HTML(900자): ' + (dumpRoot.outerHTML || '').slice(0, 900) });
        } catch(e3) {}
      }
      send({ type: 'currentVideoUrl', url: found });
    } catch(e) {
      try { send({ type: 'domlog', text: '즐겨찾기: 예외 ' + (e && e.message) }); } catch(e4) {}
      send({ type: 'currentVideoUrl', url: null });
    }
  };

  startEndedObserver();
  setInterval(houseKeeping, 3000);
  // 🔴 2026-08-16(7차, 화면 녹화 프레임 분석으로 확정) — decideVideoOffscreen(50ms 스윕)은 영상
  // 크기를 화면 밖에서 미리 끝내두지만, 아이콘(RN 오버레이) 갱신은 pollActiveVideo의 "활성 영상
  // 바뀜" 감지에만 의존했다 — 그게 500ms 주기라, 영상은 이미 새 걸로 바뀌었는데 아이콘은 최대
  // 500ms 동안 *이전* 영상 숫자를 그대로 들고 있는 걸 실제 화면 녹화(프레임별 캡처)로 확인했다.
  // 영상 스케일과 같은 촘촘함으로 맞춘다 — pollActiveVideo 자체의 다른 일(무음 안전망, 진행률)도
  // 이 주기로 도는 게 오히려 더 정확하다(더 늦게가 아니라).
  setInterval(pollActiveVideo, 50);
  setTimeout(dismissAppBanner, 1500);
  setTimeout(dismissAppBanner, 3000);
  } // mainInit 끝

  // "완전 로드"가 아니라 DOMContentLoaded(또는 이미 그 시점을 지났으면 즉시) 기준으로 실행.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mainInit);
  } else {
    mainInit();
  }
})();
true;
`;

export const TikTokShortsPlayer = forwardRef<ShortsPlayerHandle, Props>(function TikTokShortsPlayer(
  { playing, onEnded, onReady, onError, onProgress, initialMuted }: Props,
  ref
) {
  const webRef = useRef<WebView>(null);
  // 🔴 2026-09-02 사장님("틱톡 특정 영상에서 안 넘어가고 같은 영상만 리플레이 — 손으로 스와이프해도 반복")
  //   틱톡이 다음 슬라이드를 안 내주면(피드 벽/게이트/네트워크) 합성 스크롤도 실제 스와이프도 못 넘고
  //   같은 영상이 루프백한다. 6회 실패 후 래치만 풀 뿐 탈출이 없었다 — tt_adv 'stuck'이 연속되면
  //   피드를 리로드해 새 콘텐츠를 받아 빠져나온다(빈 피드 워치독과 같은 방식, 세션당 3회 상한).
  const ttStuckCountRef = useRef(0);
  const ttStuckReloadRef = useRef(0);
  const [ready, setReady] = useState(false);
  // ⚠️ 2026-09-02 되돌림 — 유튜브에 있는 데드맨 워치독을 틱톡에도 이식했다가 **화면이 멈추는**
  //   회귀를 만들었다(사장님 실기기: "focus on 키고 좀있다 꺼지네 그래서 다시 누르니 화면
  //   멈춰있고"). 유튜브에서 그 워치독이 성립하는 근거는 **페이지가 살아 있으면 pollTick이
  //   최소 500ms 간격으로 무조건 postMessage한다**는 것인데, 틱톡 페이지에는 그 전제가 없다.
  //   여기서 유일하게 주기적으로 나가는 progress는 `<video>`가 있고 duration이 유효할 때만
  //   보내므로(pollActiveVideo 참고), 로딩 중·관심사 게이트·영상 스톨 상태에서는 **정상인데도
  //   아무 메시지가 안 나간다** → 워치독이 12초마다 리로드 → 영원히 로딩 = 멈춘 화면.
  //   되살리려면 먼저 페이지에 **무조건 도는 하트비트**를 심어야 한다(houseKeeping 3초 틱에서
  //   조건 없이 send). 그 전제 없이 워치독만 켜는 것은 회귀다.
  const [showSpinner, setShowSpinner] = useState(false);
  // 2026-08-16 — hideIconRailAndScaleVideo가 세로 풀스크린을 위해 페이지 자체 좋아요/댓글/북마크/
  // 공유 아이콘 열을 숨긴 대가로, RN이 그 자리에 오버레이 버튼을 그리기 위한 카운트 상태.
  const [iconCounts, setIconCounts] = useState<{ like: string; comment: string; favorite: string; share: string } | null>(null);
  // 2026-08-16 — 사장님 지적("처음 틀면 왼쪽에 기다란 바가 나왔다가 없어지면서 전체 창으로") —
  // hideIconRailAndScaleVideo의 풀스크린 판단이 첫 houseKeeping 틱(최대 3초 뒤)에야 끝나서, 그
  // 전까지는 원래(레터박싱) 모습이 잠깐 보이다 스케일이 걸리며 눈에 띄게 커지는 전환이 보였다.
  // 로딩 커버를 이 판단이 최소 한 번 끝날 때까지(fsDecided) 계속 유지해 전환 자체를 안 보이게 한다.
  const [fsDecided, setFsDecided] = useState(false);
  // 2026-08-15 — getCurrentVideoUrl()의 요청/응답 다리. injectJavaScript는 결과를 동기로 못
  // 돌려주므로(fire-and-forget), 요청 시점에 여기 resolver를 심어두고 onMessage의
  // 'currentVideoUrl'이 도착하면 그걸로 resolve한다. 동시에 하나만 진행 가능(현재 영상 하나에
  // 대한 요청이라 실제로 겹칠 일이 없음) — 새 요청이 오면 이전 걸 null로 흘려보낸다.
  const currentVideoUrlResolverRef = useRef<((url: string | null) => void) | null>(null);

  // 2026-08-16 — hideIconRailAndScaleVideo가 페이지 자체 좋아요/댓글/북마크/공유 아이콘 열을
  // 숨긴 대가로, RN 오버레이 버튼(아래 렌더)이 탭될 때 숨겨진 실제 페이지 버튼을 대신 눌러준다
  // (활성 영상 컨테이너 안에서만 찾아 다른 프리로드된 영상의 버튼을 잘못 누르는 사고 방지).
  // useImperativeHandle의 tapIcon(부모 ref용)과 아래 오버레이 버튼 onPress 둘 다 이걸 쓴다.
  function tapIcon(name: string) {
    webRef.current?.injectJavaScript(`(function(){
      try {
        var vids = document.querySelectorAll('video');
        var v = null, best = -1, vh = window.innerHeight;
        for (var i=0;i<vids.length;i++){
          var r = vids[i].getBoundingClientRect();
          var ov = Math.min(r.bottom, vh) - Math.max(r.top, 0);
          if (ov > best) { best = ov; v = vids[i]; }
        }
        var container = v && v.closest ? v.closest('[data-e2e="recommend-list-item-container"]') : null;
        var el = container ? container.querySelector('[data-e2e="${name}"]') : document.querySelector('[data-e2e="${name}"]');
        if (el) { el.click(); }
      } catch(e) {}
    })(); true;`);
  }

  // 유튜브 플레이어와 같은 handle 시그니처를 맞추되, 틱톡은 큐레이션이 없어 advance/previous가
  // 스와이프 큐 이동이 아니라 "지금 재생 중인 video에 대해 다음 영상 시도"를 직접 트리거한다
  // (BT 리모컨/볼륨키 입력에서 재사용). previous는 대응하는 방법이 없어 no-op.
  useImperativeHandle(ref, () => ({
    advance: () => {
      webRef.current?.injectJavaScript('window.paceForceAdvance && window.paceForceAdvance(); true;');
    },
    previous: () => {},
    setMuted: (muted) => {
      // window.__paceMuted에도 저장 — 자동넘김(tryAdvance)이 새 video로 옮겨간 직후 이 값을
      // 즉시 적용해야, RN의 다음 무음스위치 폴링(최대 2초)까지 잠깐 소리가 새는 걸 막는다.
      webRef.current?.injectJavaScript(`(function(){window.__paceMuted=${muted};var v=document.querySelector('video'); if(v){v.muted=${muted};}})();true;`);
    },
    tapIcon: (name) => tapIcon(name),
    // QA_MATRIX.md 1-4b(맥 세션 요청) — 안드로이드가 이미 구현한 "검색은 우리 UI, 결과는 틱톡
    // 화면" 패턴의 iOS 버전. 딥링크로 외부 앱/브라우저를 여는 대신, 이미 떠 있는 같은 WebView를
    // 틱톡 검색 URL로 이동시킨다(안드에서 https://www.tiktok.com/search가 크롬을 띄운 원인은
    // Linking.openURL로 "밖"으로 나가서지 URL 자체 문제가 아니었다 — 우리는 안 나간다).
    // 빈 문자열이면 검색 종료 → /foryou로 복귀.
    search: (query) => {
      const url = query.trim()
        ? `https://www.tiktok.com/search?q=${encodeURIComponent(query.trim())}`
        : 'https://www.tiktok.com/foryou';
      webRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
    },
    // __DEV__ 전용 — sharedShortsPlayer.ts의 타입 주석 참고. 실제 손가락 탭과 똑같이 진짜 <a> 요소의
    // .click()을 호출한다(합성 이벤트가 아니라 그 엘리먼트의 실제 클릭 핸들러 체인을 그대로 태움).
    debugClickFirstSearchResult: () => {
      webRef.current?.injectJavaScript(`(function(){
        try {
          var links = document.querySelectorAll('a');
          var found = null;
          for (var i = 0; i < links.length; i++) {
            var href = links[i].getAttribute('href') || '';
            if (href.indexOf('/video/') !== -1) { found = links[i]; break; }
          }
          if (found) {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '디버그클릭: ' + found.getAttribute('href') }));
            found.click();
          } else {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '디버그클릭: /video/ 링크 못 찾음, a태그 ' + links.length + '개' }));
          }
        } catch(e) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '디버그클릭 실패: ' + e.message }));
        }
      })(); true;`);
    },
    // __DEV__ 전용 — "/foryou 화면이 작게 보인다"(2026-08-15) 미해결 조사용, 다음 세션에서 이어서
    // 쓸 것(위 mainInit의 4차 코멘트 참고). 실제 <video> 요소와 그 조상들의 렌더링 크기·인라인
    // style을 뷰포트와 비교해 숫자로 확인.
    debugVerifyVideoSize: () => {
      webRef.current?.injectJavaScript(`(function(){
        try {
          var vw = window.innerWidth, vh = window.innerHeight;
          var vids0 = document.querySelectorAll('video');
          var v = null, best0 = -1;
          for (var vi0 = 0; vi0 < vids0.length; vi0++) {
            var vr0 = vids0[vi0].getBoundingClientRect();
            var ov0 = Math.min(vr0.bottom, vh) - Math.max(vr0.top, 0);
            if (ov0 > best0) { best0 = ov0; v = vids0[vi0]; }
          }
          if (!v) {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '📐영상크기검증: video 없음, path=' + location.pathname }));
            return;
          }
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '📐헤더 path=' + location.pathname + ' vw=' + vw + ' vh=' + vh }));
          var el = v;
          var depth = 0;
          var article = null;
          while (el && depth < 16) {
            var r = el.getBoundingClientRect();
            var cs = window.getComputedStyle(el);
            var cn = String(el.className||'').split(' ').pop();
            var line = depth + ':' + el.tagName + '.' + cn + ' w=' + Math.round(r.width) + ' h=' + Math.round(r.height) + ' t=' + Math.round(r.top) + ' b=' + Math.round(r.bottom) + ' tf=' + el.style.getPropertyValue('transform');
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '📐' + line }));
            if (el.tagName === 'ARTICLE') article = el;
            el = el.parentElement;
            depth++;
          }
        } catch(e) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '영상크기검증실패: ' + e.message }));
        }
      })(); true;`);
    },
    debugClickByDataE2E: (name) => {
      webRef.current?.injectJavaScript(`(function(){
        try {
          var el = document.querySelector('[data-e2e="${name}"]');
          if (el) {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '디버그클릭(e2e=${name}): 찾음, href=' + (el.getAttribute('href')||'') }));
            el.click();
          } else {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '디버그클릭(e2e=${name}): 못 찾음' }));
          }
        } catch(e) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'domlog', text: '디버그클릭(e2e=${name}) 실패: ' + e.message }));
        }
      })(); true;`);
    },
    // "현재 영상 즐겨찾기 추가"의 틱톡 버전 — WebView 안에서 지금 활성 video의 공유 permalink를
    // 찾아 돌려준다(shared/ShortsPlayerHandle에 선택 프로퍼티로 추가, YouTube는 큐의 current로
    // 이미 알고 있어 구현 안 함). 1.5초 안에 응답이 없으면(페이지 전환 중 등) null로 포기.
    getCurrentVideoUrl: () => new Promise<string | null>((resolve) => {
      currentVideoUrlResolverRef.current = resolve;
      webRef.current?.injectJavaScript('window.paceGetCurrentVideoUrl && window.paceGetCurrentVideoUrl(); true;');
      setTimeout(() => {
        if (currentVideoUrlResolverRef.current === resolve) {
          currentVideoUrlResolverRef.current = null;
          resolve(null);
        }
      }, 1500);
    }),
  }), []);

  useEffect(() => {
    if (ready || showSpinner) return;
    const t = setTimeout(() => setShowSpinner(true), 450);
    return () => clearTimeout(t);
  }, [ready, showSpinner]);

  // fsDecided(hideIconRailAndScaleVideo의 풀스크린 판단 완료 신호)가 어떤 이유로든(에러난 페이지,
  // /foryou가 아닌 경로로 로드 등) 안 오면 로딩 커버가 영원히 안 걷힐 수 있다 — ready 이후 일정
  // 시간 지나도 안 오면 그냥 진행(안전장치, 없어도 되는 페이지에서 무한 대기 방지).
  // 🔴 2026-08-16 사장님 실기기+시뮬레이터 녹화 프레임 분석으로 확정 — 5초는 너무 짧았다: 틱톡
  // 자체 "관심사 게이트"(콜드 스타트 시 뜨는 초기 로딩/온보딩성 화면, 예전 주석에 6초 대기로
  // 이미 기록돼 있었음) 때문에 ready(video readyState>=2)는 일찍 뜨는데 실제 /foryou 피드 영상이
  // 자리잡고 hideIconRailAndScaleVideo가 진짜 판단을 끝내는 덴 그보다 더 걸릴 수 있다 — 5초
  // 안전장치가 먼저 발동해 로딩 커버를 강제로 걷어버리면, 그 아래 아직 마무리 안 된 상태(왼쪽
  // 사이드바 노출 + 레터박싱된 영상)가 몇 초간 그대로 노출됐다(녹화로 실측: 최대 7초까지 걸림).
  // 실측된 최악 케이스보다 넉넉하게 10초로 늘린다.
  useEffect(() => {
    if (!ready || fsDecided) return;
    const t = setTimeout(() => setFsDecided(true), 10000);
    return () => clearTimeout(t);
  }, [ready, fsDecided]);

  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(
      `(function(){var v=document.querySelector('video'); if(v){${playing ? 'v.play().catch(function(){});' : 'v.pause();'}}})();true;`
    );
  }, [ready, playing]);

  // 위 Props 주석 참고 — window.__paceMuted를 스크립트 본문보다 먼저 세팅해 콜드 스타트 무음샘 확보.
  const injectedScriptWithMuteSeed = `window.__paceMuted=${initialMuted ? 'true' : 'false'};` + INJECTED_JS_BEFORE_LOAD;

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{ uri: 'https://www.tiktok.com/foryou' }}
        style={styles.web}
        // 2026-08-14(28차) — injectedJavaScript(페이지 "완전 로드" 후 주입) prop을 더 이상 안 쓴다
        // — 핵심 로직 전부가 BeforeContentLoaded 안의 mainInit()(DOMContentLoaded 기준)로 옮겨감.
        injectedJavaScriptBeforeContentLoaded={injectedScriptWithMuteSeed}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // 2026-08-14 되돌림 — sharedCookiesEnabled={false}로 바꾼 뒤 실기기에서 페이지 로딩
        // 자체가 영원히 안 끝나는 회귀가 났다(같은 폰 Safari로 tiktok.com은 정상 — 네트워크/틱톡
        // 서버는 멀쩡, WebView 설정 문제로 확정). "모바일 쿠키를 데스크톱 UA가 들고 있어 봇탐지에
        // 걸린다"는 가설 자체는 여전히 유효할 수 있지만, 끄는 구현이 다른 문제(아마 틱톡의 초기
        // 리다이렉트/동의 체인이 기존 쿠키 존재를 전제해 무한 대기)를 만든 것으로 보여 원복한다.
        sharedCookiesEnabled
        onShouldStartLoadWithRequest={(req) => isAllowedNavigation(req.url)}
        // 깨끗한 데스크톱 Chrome(맥) UA — 모바일 UA는 실기기에서 자동 다음영상 넘김이 8개 기법+
        // 진짜 손가락 스와이프까지 전부 1회 이동 후 영구 고착됐다(QA_MATRIX.md 2026-08-12 참고).
        // 🔴 2026-08-15(9차) 재검증 — "유튜브는 모바일 UA로 전체화면인데 왜 틱톡은 안 되냐" 질문에
        // 답하려고 시뮬레이터에서 모바일 UA(유튜브와 동일값)로 다시 테스트: 레이아웃은 기대대로
        // 완벽(네이티브 앱과 동일하게 꽉 참+아이콘 오버레이+하단 탭바까지) BUT 자동 넘김 고착 버그가
        // 그대로 재현됨(1차 넘김 후 2차 시도가 같은 영상에 멈춤, "TikTok 열기" 유도 모달까지 계속
        // 뜸) — 2026-08-12 판단이 여전히 유효함을 재확인. 화면보다 시청 기능이 우선이라 데스크톱
        // UA 유지, 세로 레터박싱은 이 UA를 유지한 채 다른 방법(RN 오버레이 재구현 등)으로 풀 것.
        userAgent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        // 🔴 2026-08-14(31~34차) — injectedJavaScriptBeforeContentLoaded/imperative injectJavaScript
        // 둘 다 시각적으로 확인이 안 돼(라임 outline/DOM 마커 테스트) react-native-webview+Fabric
        // 버그(GitHub #3727)로 잠정 결론 내렸었는데, **틀렸다.** react-native-webview를
        // 13.16.1→16.0.0으로 올렸더니(이 업그레이드로 injectJavaScript 실패 시 에러가 실제로
        // 콘솔에 찍히기 시작함 — 13.16.1은 이걸 완전히 삼켰다) 진짜 원인이 드러났다:
        // `SyntaxError: Unterminated regular expression literal '/'`. 원인은 INJECTED_JS_BEFORE_LOAD
        // 내부의 `.replace(/\n/g, ' ')` — 이 TS 템플릿 리터럴(백틱 문자열) 안에서 `\n`은 TS 자체가
        // "이스케이프 시퀀스"로 먼저 해석해 진짜 개행문자로 바꿔버린다. 그 결과 런타임에 WebView로
        // 전달되는 실제 문자열은 정규식 `/\n/g`가 아니라 `/` + 진짜 개행 + `/g`였고, 이건 문법적으로
        // "닫히지 않은 정규식"이라 스크립트 전체가 파싱 단계에서 죽어 있었다(`\\n`으로 고쳐 해결,
        // 커밋 참고). 즉 업스트림 버그가 아니라 **우리 스크립트의 SyntaxError가 처음부터 있었고,
        // 13.16.1이 그 실패를 완전히 침묵시켜서 며칠간 원인을 못 찾았던 것** — 라이브러리 업그레이드
        // 자체가 고친 게 아니라 에러 메시지를 드러내준 덕분에 진짜 원인을 찾은 것.
        // 이 재주입(onLoadStart/onLoad)은 이제 정말로 동작한다(시뮬레이터 스크린샷/로그로 확인:
        // PACEWV 로그 정상 출력, 네이티브 전체화면 승격 없이 P버튼/배지 유지). 다만 여전히 남겨두는
        // 이유는 — react-native-webview 13.x의 injectedJavaScriptBeforeContentLoaded prop이
        // (raw 시각 테스트로는) 안 먹혔던 것도 사실이라, prop보다 이 imperative 경로가 더 신뢰도가
        // 높다고 판단해서다.
        onLoadStart={() => { webRef.current?.injectJavaScript(injectedScriptWithMuteSeed); }}
        onLoad={() => { webRef.current?.injectJavaScript(injectedScriptWithMuteSeed); }}
        onError={(e) => { if (__DEV__) console.log('[TikTok WV] onError', e.nativeEvent?.code); }}
        onHttpError={(e) => { if (__DEV__) console.log('[TikTok WV] httpError', e.nativeEvent?.statusCode); }}
        onContentProcessDidTerminate={() => webRef.current?.reload()}
        onMessage={(e) => {
          let msg: { type?: string; value?: number; url?: string | null; like?: string; comment?: string; favorite?: string; share?: string } = {};
          try {
            msg = JSON.parse(e.nativeEvent.data);
          } catch {
            return;
          }
          if (msg.type === 'ttadv') {
            const m = msg as unknown as { st?: string; t?: number };
            diagLog('tt_adv', `${m.st}${m.t != null ? ' t=' + m.t : ''}`);
            if (m.st === 'moved') { ttStuckCountRef.current = 0; }
            else if (m.st === 'stuck') {
              ttStuckCountRef.current += 1;
              // 3연속 stuck = 이 영상에 갇혔다. 피드를 리로드해 새 콘텐츠로 탈출(세션당 3회).
              if (ttStuckCountRef.current >= 3 && ttStuckReloadRef.current < 3) {
                ttStuckReloadRef.current += 1;
                ttStuckCountRef.current = 0;
                diagLog('tt_stuck_reload', '#' + ttStuckReloadRef.current);
                webRef.current?.reload();
              }
            }
            return;
          }
          if (msg.type === 'advdrop') {
            // 실행시점 게이트가 밀린 advance 묶음을 버렸다 — 재발 검증 물증(Release에서도 남음).
            diagLog('adv_drop_burst');
            return;
          }
          if (msg.type === 'domlog') {
            try { if (__DEV__) getPaceGestureLog()?.nativeLog?.(String((msg as any).text ?? '')); } catch {}
            return;
          }
          if (msg.type === 'iconState') {
            if ((msg as any).clear) { setIconCounts(null); return; }
            setIconCounts({ like: msg.like ?? '', comment: msg.comment ?? '', favorite: msg.favorite ?? '', share: msg.share ?? '' });
            return;
          }
          if (msg.type === 'fsDecided') {
            setFsDecided(true);
            return;
          }
          if (msg.type === 'ready') {
            setReady(true);
            onReady?.();
          } else if (msg.type === 'progress') {
            if (typeof msg.value === 'number') {
              if (msg.value > 0 && !ready) { setReady(true); onReady?.(); }
              onProgress?.(msg.value);
            }
          } else if (msg.type === 'ended') {
            onEnded();
          } else if (msg.type === 'currentVideoUrl') {
            const resolve = currentVideoUrlResolverRef.current;
            currentVideoUrlResolverRef.current = null;
            resolve?.(msg.url ?? null);
          } else if (msg.type === 'novideo') {
            if (__DEV__) console.log('[TikTok WV] novideo → skip', JSON.stringify(msg));
            onError?.(-2);
          }
        }}
      />
      {!(ready && fsDecided) && (
        <View style={styles.loadingCover} pointerEvents="none">
          {showSpinner && <ActivityIndicator size="large" color="#FFFFFF" />}
        </View>
      )}
      {/* 2026-08-16 — hideIconRailAndScaleVideo가 세로 풀스크린을 위해 페이지 자체 좋아요/댓글/
          북마크/공유 아이콘 열을 숨긴 대가로, 그 자리를 RN 오버레이 버튼으로 대신한다. 탭하면
          tapIcon()이 숨겨진 실제 페이지 버튼을 대신 눌러 기능은 그대로 유지된다. iconCounts가
          아직 없으면(첫 로드 전) 안 그린다 — 빈 0으로 깜빡이는 것보다 낫다. */}
      {ready && iconCounts && (
        <View style={localStyles.iconRail} pointerEvents="box-none">
          <IconRailButton icon="heart" count={iconCounts.like} onPress={() => tapIcon('like-icon')} />
          <IconRailButton icon="chatbubble-ellipses" count={iconCounts.comment} onPress={() => tapIcon('comment-icon')} />
          <IconRailButton icon="bookmark" count={iconCounts.favorite} onPress={() => tapIcon('favorite-icon')} />
          <IconRailButton icon="arrow-redo" count={iconCounts.share} onPress={() => tapIcon('share-icon')} />
        </View>
      )}
    </View>
  );
});

function IconRailButton({ icon, count, onPress }: { icon: keyof typeof Ionicons.glyphMap; count: string; onPress: () => void }) {
  return (
    <Pressable style={localStyles.iconButton} onPress={onPress} hitSlop={10}>
      <View style={localStyles.iconCircle}>
        <Ionicons name={icon} size={26} color="#FFFFFF" />
      </View>
      {!!count && <Text style={localStyles.iconCount}>{count}</Text>}
    </Pressable>
  );
}

const localStyles = StyleSheet.create({
  iconRail: {
    position: 'absolute',
    right: 10,
    bottom: 90,
    alignItems: 'center',
    gap: 18,
  },
  iconButton: { alignItems: 'center', gap: 4 },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCount: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
