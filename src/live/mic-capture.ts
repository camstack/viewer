/**
 * mic-capture — robust microphone capture for talk-back (native).
 *
 * WHY THIS EXISTS (regression after the Expo 57 / RN 0.86 / New-Architecture +
 * react-native-webrtc 124 bump): the library's own `mediaDevices.getUserMedia`
 * runs a JS-side permission GATE before it reaches native —
 * `permissions.request({ name: 'microphone' })` → `WebRTCModule.requestPermission`.
 * Under the new bridgeless runtime that gate no longer resolves reliably: it
 * yields a non-`true` value even when the OS microphone permission IS granted,
 * so `getUserMedia` short-circuits with `SecurityError: Permission denied.` and
 * talk-back dies with a spurious "permission check" failure. This is the ONLY
 * permission check anywhere in the app (there are no expo-camera/av/audio
 * permission calls), so it is the sole source of the reported symptom.
 *
 * FIX: capture the mic by calling the NATIVE `WebRTCModule.getUserMedia`
 * directly (the exact post-gate path the library itself runs) and building the
 * `MediaStream` wrapper ourselves — skipping the flaky JS gate entirely. The OS
 * is still the real authority: the record permission prompt is raised by the
 * `PlayAndRecord` audio-session activation (see `configureForIntercom`) and by
 * `AVCaptureDevice`, and we additionally fire a best-effort prompt below so a
 * first-run user still sees the standard dialog. This keeps the fix pure-JS
 * (OTA-shippable) with no `node_modules` patch.
 */
import { NativeModules, PermissionsAndroid, Platform } from 'react-native'
import { MediaStream, mediaDevices } from 'react-native-webrtc'

/** Constructor arg shape for the library's `MediaStream` (object branch). */
type MediaStreamInfo = ConstructorParameters<typeof MediaStream>[0]

/** The slice of the react-native-webrtc native module we call directly. */
interface WebRTCModuleLike {
  getUserMedia?(
    constraints: { audio: boolean; video?: boolean },
    // Native returns partial track descriptors (no `constraints` /
    // `peerConnectionId` for a fresh local track); typed loosely and handed
    // straight to the `MediaStream` wrapper the library itself builds.
    success: (streamId: string, tracks: readonly unknown[]) => void,
    failure: (type: string, message: string) => void,
  ): void
  requestPermission?(mediaType: string): Promise<boolean>
}

function nativeModule(): WebRTCModuleLike | undefined {
  return NativeModules.WebRTCModule as WebRTCModuleLike | undefined
}

/**
 * Best-effort OS permission prompt for first-run users. NEVER gates capture:
 * whatever it resolves (or throws), we proceed — the whole point is that the
 * library's gate is unreliable, so we let the OS enforce at record time.
 */
async function primeMicPermission(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
    } else if (Platform.OS === 'ios') {
      await nativeModule()?.requestPermission?.('microphone')
    }
  } catch {
    // ignore — the prompt is a nicety; capture must not depend on it.
  }
}

/**
 * Capture an audio-only {@link MediaStream} for talk-back. Bypasses the
 * library's JS permission gate (see file header). Falls back to the standard
 * `mediaDevices.getUserMedia` if the native module shape is unexpected, so no
 * platform is left without a capture path.
 */
export async function captureMicStream(): Promise<MediaStream> {
  await primeMicPermission()

  const mod = nativeModule()
  if (!mod?.getUserMedia) {
    // Unexpected bridge shape (e.g. web / a future native change) — defer to
    // the library's own implementation rather than failing hard.
    return mediaDevices.getUserMedia({ audio: true }) as Promise<MediaStream>
  }

  return new Promise<MediaStream>((resolve, reject) => {
    // ONLY pass `audio`. A falsy `video` key is a non-nil NSNumber on iOS and
    // would make the native layer try to open the camera.
    mod.getUserMedia!(
      { audio: true },
      (streamId, tracks) => {
        try {
          // Same wrapper the library builds after its native call succeeds.
          // The native track descriptors are the library's own payload — one
          // documented cast at the bridge boundary onto its constructor type.
          const info = { streamId, streamReactTag: streamId, tracks } as MediaStreamInfo
          resolve(new MediaStream(info))
        } catch (e) {
          reject(e instanceof Error ? e : new Error('mic-stream-build-failed'))
        }
      },
      (type, message) => reject(new Error(message || type || 'mic-capture-failed')),
    )
  })
}
