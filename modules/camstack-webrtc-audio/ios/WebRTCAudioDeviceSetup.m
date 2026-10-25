#import "WebRTCAudioDeviceSetup.h"
#import <AVFoundation/AVFoundation.h>
#import <WebRTC/WebRTC.h>
#import "WebRTCModuleOptions.h"

@implementation WebRTCAudioDeviceSetup

+ (void)configure {
  // AUAudioUnitRTCAudioDevice: Playback-first, activates input only when mic is used.
  Class deviceClass = NSClassFromString(@"AUAudioUnitRTCAudioDevice");
  if (deviceClass) {
    id<RTCAudioDevice> device = [[deviceClass alloc] init];
    [WebRTCModuleOptions sharedInstance].audioDevice = device;
    NSLog(@"[WebRTCAudioDeviceSetup] Using AUAudioUnitRTCAudioDevice");
  } else {
    NSLog(@"[WebRTCAudioDeviceSetup] AUAudioUnitRTCAudioDevice not found, using default");
  }

  // Config per WebRTC SDK (RTCAudioSessionConfiguration.m):
  // PlayAndRecord required: with sendrecv audio, WebRTC calls startRecording and playback needs it.
  // Playback-only caused -50 errors and broke audio. Yellow dot controlled by configureForPlayback
  // (micPressed) only when releasing mic — not viable to avoid dot during initial playback.
  RTCAudioSessionConfiguration *config = [RTCAudioSessionConfiguration webRTCConfiguration];
  config.category = AVAudioSessionCategoryPlayAndRecord;
  config.mode = AVAudioSessionModeDefault;
  config.categoryOptions = AVAudioSessionCategoryOptionAllowBluetooth
    | AVAudioSessionCategoryOptionAllowBluetoothA2DP
    | AVAudioSessionCategoryOptionDefaultToSpeaker
    | AVAudioSessionCategoryOptionMixWithOthers;
  [RTCAudioSessionConfiguration setWebRTCConfiguration:config];
}

@end
