import React from 'react';
import { Pressable, Text, View } from 'react-native';

// 감사 발견(크래시 안전성, HIGH, 2026-07-27) — 앱에 최상위 ErrorBoundary가 없어, _layout의 프로바이더
// 트리(GestureHandlerRootView/SafeAreaProvider/QueryClientProvider) 어디서든 렌더 throw가 나면 expo-router의
// 라우트 레벨 바운더리보다 위라 복구 불가능한 백색화면이 된다(심사원 기기에서 이러면 거부). 여기서 잡아
// 최소한의 안내 + "다시 시도"를 보여준다. i18n/테마가 원인일 수 있어 그 어떤 훅/스토어에도 의존하지 않고
// 하드코딩 스타일·이중언어 문자열만 쓴다(라스트 리조트라 단순·자기완결적이어야 함).
type Props = { children: React.ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // 릴리즈에서도 최소한 기기 콘솔엔 남겨 사후 진단이 가능하게(사용자에겐 안 보임).
    console.error('[ErrorBoundary] 최상위 렌더 오류:', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: '#060709', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
          문제가 발생했어요{'\n'}Something went wrong
        </Text>
        <Text style={{ color: '#9BA1A6', fontSize: 13, textAlign: 'center', marginBottom: 24, lineHeight: 19 }}>
          앱을 다시 시도하거나 재실행해 주세요.{'\n'}Please try again or restart the app.
        </Text>
        <Pressable
          onPress={() => this.setState({ hasError: false })}
          style={{ backgroundColor: '#4F8CFF', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10 }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>다시 시도 · Try again</Text>
        </Pressable>
      </View>
    );
  }
}
