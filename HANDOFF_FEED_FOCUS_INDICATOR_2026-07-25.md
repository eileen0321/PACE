# Handoff — Feed 상단 UI 정리 & 집중모드 ⚡ 인디케이터 (2026-07-25, iOS 세션)

Android 세션이 **동일하게** 반영해야 하는 변경. iOS는 `src/app/feed/index.tsx`에 적용 완료.

## 배경 (사용자 지시 흐름)
- "유투브 화면 상단 X는 왜 만들었냐 / 화면 가리지 마라" → 상단은 최소만.
- "Focus 집중모드 표시는 안 하냐" → 집중모드 ON 표시가 필요.
- "화면에 자꾸 뭘 늘리지 마라" → 상시 필/텍스트 금지.
- 최종 결정: **"P 옆에 글래스모피즘 ⚡(번개) 아이콘을 집중모드 ON일 때만" 띄운다. OFF면 아예 렌더 안 함.**

## 정확한 스펙
1. 피드 상단 우측 = `[⚡] [P]` (오른쪽 정렬, gap = spacing.sm).
2. **P 버튼**: 항상 표시. 글래스(BlurView intensity 24, tint dark), 36×36 원, hairline 테두리 rgba(255,255,255,0.22). 탭 → 앱(Home) 복귀. 색/모양은 집중모드와 **무관하게 중립 유지**(P 자체는 상태 표시 안 함).
3. **⚡ 인디케이터**: `isAutoMode`(= Focus Session/자동 정주행 ON)일 때만 렌더. OFF면 컴포넌트 자체를 안 그림.
   - P와 동일한 36×36 글래스 원(BlurView intensity 24, tint dark, overflow hidden).
   - 테두리는 보라 링: `borderColor: ${colors.primary}66` (P의 흰 hairline과 구분되는 "집중 중" 시그널).
   - 아이콘: Feather `zap`, size 15, color `colors.primary`.
   - 등장/퇴장 애니메이션: reanimated `FadeIn.duration(260)` / `FadeOut.duration(200)`.
4. **제거된 것**(군더더기): 상단 X(닫기), "Pace Feed" 카테고리 필, 인앱 시간 상태바(시스템 상태바와 겹침), 하단 미디어 컨트롤(skip/play/pause — 동작 안 함), 그리고 이번에 시도했다 폐기한 `SessionTimePill`("⚡ Focus" 상시 필). 상시 카운트다운/남은시간은 iOS는 다이나믹아일랜드(Live Activity)가 담당.

## Android 반영 포인트
- Android 피드/오버레이에서 "집중모드 ON" 상태에 해당하는 플래그(iOS의 `isAutoMode` = 자동 정주행 스위치)를 찾아 동일 조건으로 ⚡ 인디케이터를 노출.
- 글래스모피즘: Android는 expo-blur BlurView가 동일 동작(experimentalBlurMethod 필요할 수 있음) — 안 되면 반투명 어두운 배경 + 보라 테두리로 폴백.
- 상단은 "복귀 버튼 하나 + (ON일 때만)⚡"만. 그 외 상단 오버레이 요소는 영상 안 가리게 최소화.
- 시스템 상태바 겹침 주의: iOS는 `useSafeAreaInsets().top`(모달에서 0이면 47 폴백)로 topBar marginTop 보정. Android도 상태바 높이만큼 상단 여백 확보.

## 아이콘
- `assets/ios-icon.png`를 풀블리드(모서리까지 꽉 찬 사각형)로 교체. 기존엔 **둥근 모서리 프레임 + 상단 광택**이 이미지에 구워져 있어 iOS 마스크와 **이중 마스킹** → "짤린 것처럼" 보이고 상단 흰 띠 발생. 스케일업 후 중앙 크롭으로 구워진 프레임 제거.
- Android adaptiveIcon foreground(`assets/android-icon-foreground.png`)도 세이프존(안쪽 66%) 안에 매듭이 들어오는지 확인 — 넘치면 잘림.
