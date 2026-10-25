//
//  WebRTCModule+AudioSessionControl.m
//
//  Extends react-native-webrtc's WebRTCModule with fine-grained audio session
//  control via RTCAudioSession (Google WebRTC).
//
//  All methods live on the existing WebRTCModule bridge and use RTCAudioSession
//  (not AVAudioSession directly) to prevent conflicts with WebRTC's internal
//  audio management.
//

#import <AVFoundation/AVFoundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <WebRTC/WebRTC.h>
#import "WebRTCModuleOptions.h"

// Forward-declare the class we're extending (defined in react-native-webrtc)
@interface WebRTCModule : RCTEventEmitter <RCTBridgeModule>
@end

// --------------------------------------------------------------------------
// Category: AudioSessionControl
// --------------------------------------------------------------------------

@interface WebRTCModule (AudioSessionControl)
@end

@implementation WebRTCModule (AudioSessionControl)

// No +load override: WebRTCAudioDeviceSetup.configure() (in AppDelegate) sets Playback
// before the bridge starts. A +load here would run when WebRTCModule loads and overwrite
// with PlayAndRecord, breaking playback-first and causing SessionCore errors.

#pragma mark - resetAudioDevice

/// Create a fresh AUAudioUnitRTCAudioDevice on the WebRTCModuleOptions singleton.
/// Call before Updates.reloadAsync() so the new WebRTCModule (created after JS
/// engine restart) gets a clean audio device. Without this, the reused device
/// from the previous RTCPeerConnectionFactory is still in "initialized" state,
/// causing AudioDeviceModule::Init() → RTC_CHECK_EQ(0, ...) → SIGABRT.
RCT_EXPORT_METHOD(resetAudioDevice:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        Class deviceClass = NSClassFromString(@"AUAudioUnitRTCAudioDevice");
        if (deviceClass) {
            id<RTCAudioDevice> device = [[deviceClass alloc] init];
            [WebRTCModuleOptions sharedInstance].audioDevice = device;
            NSLog(@"[AudioSessionControl] resetAudioDevice: fresh AUAudioUnitRTCAudioDevice created");
        }
        resolve(nil);
    } @catch (NSException *exception) {
        NSLog(@"[AudioSessionControl] resetAudioDevice exception: %@", exception);
        reject(@"ERR_AUDIO_SESSION", exception.reason, nil);
    }
}

#pragma mark - configureForPlayback

RCT_EXPORT_METHOD(configureForPlayback:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    // Switch to Playback category — no audio input, no mic indicator.
    // WebRTC has already configured with PlayAndRecord (audio works). We override to
    // Playback to hide the orange dot. MixWithOthers allows other apps to play audio.
    //
    // NOTE: AllowBluetooth is NOT valid for Playback category (only PlayAndRecord/Record).
    // Using it can throw NSInvalidArgumentException on some iOS versions, which crashes
    // when dispatched as a void method through TurboModule interop.
    // AllowBluetoothA2DP IS valid for Playback and handles Bluetooth audio output correctly.
    @try {
        RTCAudioSession *session = [RTCAudioSession sharedInstance];
        [session lockForConfiguration];
        NSError *error = nil;
        BOOL ok = [session setCategory:AVAudioSessionCategoryPlayback
                                  mode:AVAudioSessionModeDefault
                               options:AVAudioSessionCategoryOptionAllowBluetoothA2DP
                                      | AVAudioSessionCategoryOptionMixWithOthers
                                 error:&error];
        [session unlockForConfiguration];
        if (!ok) {
            NSLog(@"[AudioSessionControl] configureForPlayback setCategory failed: %@", error);
        }
        resolve(nil);
    } @catch (NSException *exception) {
        NSLog(@"[AudioSessionControl] configureForPlayback exception: %@", exception);
        reject(@"ERR_AUDIO_SESSION", exception.reason, nil);
    }
}

#pragma mark - configureForIntercom

RCT_EXPORT_METHOD(configureForIntercom:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        RTCAudioSession *session = [RTCAudioSession sharedInstance];
        [session lockForConfiguration];
        NSError *error = nil;
        BOOL ok = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                                  mode:AVAudioSessionModeVideoChat
                               options:AVAudioSessionCategoryOptionAllowBluetooth
                                      | AVAudioSessionCategoryOptionAllowBluetoothA2DP
                                      | AVAudioSessionCategoryOptionDefaultToSpeaker
                                      | AVAudioSessionCategoryOptionMixWithOthers
                                 error:&error];
        if (!ok) {
            [session unlockForConfiguration];
            reject(@"ERR_AUDIO_SESSION", error.localizedDescription, error);
            return;
        }
        // ModeVideoChat handles speaker routing inherently (and provides echo cancellation)
        [session unlockForConfiguration];
        resolve(nil);
    } @catch (NSException *exception) {
        NSLog(@"[AudioSessionControl] configureForIntercom exception: %@", exception);
        reject(@"ERR_AUDIO_SESSION", exception.reason, nil);
    }
}

#pragma mark - getAudioOutputDevices

RCT_EXPORT_METHOD(getAudioOutputDevices:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        RTCAudioSession *rtcSession = [RTCAudioSession sharedInstance];
        AVAudioSession *avSession = rtcSession.session;
        NSMutableArray *devices = [NSMutableArray array];

        // Current route outputs
        for (AVAudioSessionPortDescription *port in avSession.currentRoute.outputs) {
            [devices addObject:@{
                @"uid": port.UID ?: @"",
                @"name": port.portName ?: @"",
                @"type": [self classifyPortType:port.portType],
            }];
        }

        // Available inputs (may expose BT / headset ports not yet in current route)
        for (AVAudioSessionPortDescription *port in avSession.availableInputs) {
            NSString *uid = port.UID ?: @"";
            BOOL alreadyAdded = NO;
            for (NSDictionary *d in devices) {
                if ([d[@"uid"] isEqualToString:uid]) {
                    alreadyAdded = YES;
                    break;
                }
            }
            if (!alreadyAdded) {
                [devices addObject:@{
                    @"uid": uid,
                    @"name": port.portName ?: @"",
                    @"type": [self classifyPortType:port.portType],
                }];
            }
        }

        // Ensure built-in speaker is always listed
        BOOL hasSpeaker = NO;
        for (NSDictionary *d in devices) {
            if ([d[@"type"] isEqualToString:@"speaker"]) { hasSpeaker = YES; break; }
        }
        if (!hasSpeaker) {
            [devices addObject:@{@"uid": @"Speaker", @"name": @"Speaker", @"type": @"speaker"}];
        }

        resolve(devices);
    } @catch (NSException *exception) {
        NSLog(@"[AudioSessionControl] getAudioOutputDevices exception: %@", exception);
        reject(@"ERR_AUDIO_SESSION", exception.reason, nil);
    }
}

#pragma mark - setPreferredAudioOutput

RCT_EXPORT_METHOD(setPreferredAudioOutput:(NSString *)uid
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        RTCAudioSession *session = [RTCAudioSession sharedInstance];
        [session lockForConfiguration];
        NSError *error = nil;

        if ([uid isEqualToString:@"Speaker"] || [uid isEqualToString:@"BuiltInSpeaker"]) {
            BOOL ok = [session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:&error];
            [session unlockForConfiguration];
            ok ? resolve(nil) : reject(@"ERR_AUDIO_SESSION", error.localizedDescription, error);
            return;
        }

        // Try to match by UID in availableInputs
        AVAudioSession *avSession = session.session;
        for (AVAudioSessionPortDescription *port in avSession.availableInputs) {
            if ([port.UID isEqualToString:uid]) {
                BOOL ok = [session setPreferredInput:port error:&error];
                if (ok) {
                    [session overrideOutputAudioPort:AVAudioSessionPortOverrideNone error:nil];
                }
                [session unlockForConfiguration];
                ok ? resolve(nil) : reject(@"ERR_AUDIO_SESSION", error.localizedDescription, error);
                return;
            }
        }

        // No match — clear override so system default is used
        [session overrideOutputAudioPort:AVAudioSessionPortOverrideNone error:nil];
        [session unlockForConfiguration];
        resolve(nil);
    } @catch (NSException *exception) {
        NSLog(@"[AudioSessionControl] setPreferredAudioOutput exception: %@", exception);
        reject(@"ERR_AUDIO_SESSION", exception.reason, nil);
    }
}

#pragma mark - Helpers

- (NSString *)classifyPortType:(AVAudioSessionPort)portType {
    if ([portType isEqualToString:AVAudioSessionPortBuiltInSpeaker] ||
        [portType isEqualToString:AVAudioSessionPortBuiltInReceiver]) {
        return @"speaker";
    }
    if ([portType isEqualToString:AVAudioSessionPortHeadphones] ||
        [portType isEqualToString:AVAudioSessionPortHeadsetMic]) {
        return @"headphones";
    }
    if ([portType isEqualToString:AVAudioSessionPortBluetoothA2DP] ||
        [portType isEqualToString:AVAudioSessionPortBluetoothLE] ||
        [portType isEqualToString:AVAudioSessionPortBluetoothHFP]) {
        return @"bluetooth";
    }
    return @"other";
}

@end
