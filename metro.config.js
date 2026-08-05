const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Windows + OkHttp 개발서버 워크어라운드 (앱 로직/구조와 무관, dev 전용).
// Metro는 클라이언트가 Accept: multipart/mixed 를 보내면 번들을 multipart/mixed로 응답하는데,
// Windows에서 RN의 OkHttp 청크 디코더가 CRLF(\r, 0xd)에서
// "Expected leading [0-9a-fA-F] character but was 0xd" 로 깨져 번들 다운로드가 실패한다
// (앱이 스플래시에서 무한 대기). .bundle 요청의 Accept 헤더를 제거하면 Metro가 평문 JS로 응답 → 정상.
// (sibling jlpt-master의 metro.config.js에 이미 검증된 동일 워크어라운드)
const origEnhance = config.server && config.server.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const base = origEnhance ? origEnhance(middleware, server) : middleware;
    return (req, res, next) => {
      const url = (req.url || '').split('?')[0];
      if (url.endsWith('.bundle')) {
        delete req.headers['accept'];
      }
      return base(req, res, next);
    };
  },
};

module.exports = config;
