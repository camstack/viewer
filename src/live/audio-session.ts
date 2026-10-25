/**
 * Native audio-session control for the live stream + intercom (iOS/Android).
 *
 * iOS: the methods are added as an ObjC category on `WebRTCModule` (see
 * `plugins/audioSessionControl.ios.m`), so they live on
 * `NativeModules.WebRTCModule` next to the standard react-native-webrtc methods.
 * Android: a standalone `AudioSessionControl` native module.
 *
 * Why this matters for the WebView player: when the user starts talk-back, the
 * native react-native-webrtc mic session switches the shared `AVAudioSession`
 * category. Without explicitly configuring it for intercom (PlayAndRecord +
 * VideoChat mode + DefaultToSpeaker + MixWithOthers), the WKWebView's incoming
 * stream audio gets interrupted/rerouted and "the output audio stops reaching
 * the phone". `configureForIntercom()` on start + `configureForPlayback()` on
 * stop restores coexistence — the same flow V1 used (`src/lib/audioSessionControl`).
 *
 * Every call is null-guarded: on a platform / build where the native method is
 * absent it resolves to a no-op rather than throwing.
 */
import { NativeModules, Platform } from 'react-native'

type AudioModule = Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>

/** iOS: methods on WebRTCModule; Android: the standalone AudioSessionControl. */
const mod: AudioModule | undefined =
  Platform.OS === 'ios'
    ? (NativeModules.WebRTCModule as AudioModule | undefined)
    : (NativeModules.AudioSessionControl as AudioModule | undefined)

/** True when the native bridge exposes the audio-session methods (real build). */
export function hasAudioSessionControl(): boolean {
  return typeof mod?.configureForIntercom === 'function'
}

/**
 * Switch the audio session to PLAYBACK (no mic). Hides the orange mic indicator
 * and lets other apps / the WebView keep playing. Call when talk-back ends.
 */
export function configureForPlayback(): Promise<void> {
  const fn = mod?.configureForPlayback
  if (!fn) return Promise.resolve()
  return fn().then(() => undefined)
}

/**
 * Switch the audio session to INTERCOM (PlayAndRecord, VideoChat mode, speaker,
 * mix-with-others). Call right before opening the mic for talk-back.
 */
export function configureForIntercom(): Promise<void> {
  const fn = mod?.configureForIntercom
  if (!fn) return Promise.resolve()
  return fn().then(() => undefined)
}
