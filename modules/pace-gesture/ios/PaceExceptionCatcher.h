#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Swift는 ObjC NSException(@throw)을 try/catch로 못 잡는다. AVAudioEngine.start()/installTap 등
// AVFoundation 오디오 API는 실패 시 Swift Error가 아니라 ObjC NSException을 던져 앱을 죽인다
// (실기기 확인: -10868 "Failed to initialize active nodes in input chain"). 이 헬퍼로 @try/@catch로
// 감싸 크래시 대신 NSError로 되돌린다.
@interface PaceExceptionCatcher : NSObject
+ (BOOL)catchExceptions:(NS_NOESCAPE void (^)(void))block error:(NSError * _Nullable * _Nullable)error;
@end

NS_ASSUME_NONNULL_END
