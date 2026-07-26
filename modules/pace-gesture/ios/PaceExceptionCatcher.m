#import "PaceExceptionCatcher.h"

@implementation PaceExceptionCatcher

+ (BOOL)catchExceptions:(NS_NOESCAPE void (^)(void))block error:(NSError * _Nullable * _Nullable)error {
  @try {
    block();
    return YES;
  } @catch (NSException *exception) {
    if (error) {
      NSString *msg = exception.reason ?: exception.name ?: @"unknown NSException";
      *error = [NSError errorWithDomain:@"PaceGesture"
                                   code:-1
                               userInfo:@{ NSLocalizedDescriptionKey: msg }];
    }
    return NO;
  }
}

@end
