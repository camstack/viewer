//
//  NativeLogModule.ios.m
//
//  Captures RCTLog (React Native native + JS logs) to a JSON file.
//  Uses RCTAddLogFunction to append without replacing default behavior.
//

#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>
#import <Foundation/Foundation.h>

static NSString *const kLogFileName = @"camstack-native-logs.json";
static NSFileHandle *_logFileHandle = nil;
static NSLock *_logLock = nil;

static NSString *levelToString(RCTLogLevel level) {
  switch (level) {
    case RCTLogLevelTrace: return @"trace";
    case RCTLogLevelInfo: return @"info";
    case RCTLogLevelWarning: return @"warn";
    case RCTLogLevelError: return @"error";
    case RCTLogLevelFatal: return @"fatal";
    default: return @"log";
  }
}

static void appendToFile(RCTLogLevel level, RCTLogSource source, NSString *fileName, NSNumber *lineNumber, NSString *message) {
  if (!_logFileHandle || !_logLock) return;
  [_logLock lock];
  @try {
    NSString *sourceStr = (source == RCTLogSourceNative) ? @"native" : @"js";
    NSDictionary *entry = @{
      @"ts": @((long long)([[NSDate date] timeIntervalSince1970] * 1000)),
      @"level": levelToString(level),
      @"source": sourceStr,
      @"message": message ?: @"",
      @"file": fileName ?: [NSNull null],
      @"line": lineNumber ?: [NSNull null]
    };
    NSData *json = [NSJSONSerialization dataWithJSONObject:entry options:0 error:nil];
    if (json) {
      NSMutableData *line = [json mutableCopy];
      [line appendData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
      [_logFileHandle writeData:line];
    }
  } @catch (NSException *e) {
    // ignore
  }
  [_logLock unlock];
}

static void setupLogFile(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    _logLock = [[NSLock alloc] init];
    NSArray *paths = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
    NSString *docDir = paths.firstObject;
    if (docDir) {
      NSString *filePath = [docDir stringByAppendingPathComponent:kLogFileName];
      NSFileManager *fm = [NSFileManager defaultManager];
      if (![fm fileExistsAtPath:filePath]) {
        [fm createFileAtPath:filePath contents:nil attributes:nil];
      }
      _logFileHandle = [NSFileHandle fileHandleForWritingAtPath:filePath];
      [_logFileHandle seekToEndOfFile];
      RCTAddLogFunction(^(RCTLogLevel level, RCTLogSource source, NSString *fileName, NSNumber *lineNumber, NSString *message) {
        appendToFile(level, source, fileName, lineNumber, message);
      });
    }
  });
}

// Run setup before +load; RCT_EXPORT_MODULE() defines its own +load for module registration
__attribute__((constructor)) static void NativeLogModule_init(void) {
  setupLogFile();
}

@interface NativeLogModule : NSObject <RCTBridgeModule>
@end

@implementation NativeLogModule

RCT_EXPORT_MODULE()

RCT_EXPORT_METHOD(readLogs:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  setupLogFile();
  NSArray *paths = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
  NSString *docDir = paths.firstObject;
  if (!docDir) {
    resolve(@"");
    return;
  }
  NSString *filePath = [docDir stringByAppendingPathComponent:kLogFileName];
  NSError *err = nil;
  NSString *content = [NSString stringWithContentsOfFile:filePath encoding:NSUTF8StringEncoding error:&err];
  resolve(content ?: @"");
}

RCT_EXPORT_METHOD(clearLogs:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  setupLogFile();
  NSArray *paths = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
  NSString *docDir = paths.firstObject;
  if (!docDir) {
    resolve(nil);
    return;
  }
  NSString *filePath = [docDir stringByAppendingPathComponent:kLogFileName];
  [_logLock lock];
  [_logFileHandle closeFile];
  [[NSFileManager defaultManager] createFileAtPath:filePath contents:nil attributes:nil];
  _logFileHandle = [NSFileHandle fileHandleForWritingAtPath:filePath];
  [_logLock unlock];
  resolve(nil);
}

@end
