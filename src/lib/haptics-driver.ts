/**
 * haptics-driver — the ONLY place that touches `expo-haptics`.
 *
 * Deliberately defensive: `expo-haptics` is a NATIVE module. On an OTA update
 * pushed to an app whose native binary predates the dependency, the native side
 * is absent and any call would throw. We therefore:
 *   • no-op on web (Platform guard — expo-haptics no-ops there anyway),
 *   • load the module via a cached DYNAMIC import wrapped in try/catch, so an
 *     import-time throw is contained,
 *   • swallow any per-call rejection (missing native module) so the worst case
 *     is "no vibration", never a crash.
 *
 * Kept out of `event-haptics.ts` so that module stays React-Native-free and
 * node-testable; this file is the RN-only edge.
 */
import { Platform } from 'react-native'
import type { HapticKind } from './event-haptics.js'

/** The subset of the `expo-haptics` surface we invoke. */
interface HapticsModule {
  selectionAsync: () => Promise<void>
  impactAsync: (style?: unknown) => Promise<void>
  notificationAsync: (type?: unknown) => Promise<void>
  ImpactFeedbackStyle: { Light: unknown; Medium: unknown }
  NotificationFeedbackType: { Warning: unknown; Success: unknown; Error: unknown }
}

/** Cached module load — attempted once, memoized (including the null failure). */
let modulePromise: Promise<HapticsModule | null> | null = null

function loadHaptics(): Promise<HapticsModule | null> {
  if (Platform.OS === 'web') return Promise.resolve(null)
  if (!modulePromise) {
    modulePromise = import('expo-haptics')
      .then((m): HapticsModule | null => (isHapticsModule(m) ? m : null))
      .catch(() => null)
  }
  return modulePromise
}

/** Structural guard: the dynamically imported module exposes the calls we need. */
function isHapticsModule(m: unknown): m is HapticsModule {
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof (m as HapticsModule).selectionAsync === 'function' &&
    typeof (m as HapticsModule).impactAsync === 'function' &&
    typeof (m as HapticsModule).notificationAsync === 'function'
  )
}

/**
 * Play a haptic for the resolved {@link HapticKind}. Fire-and-forget: never
 * throws, never rejects to the caller. A missing native module (OTA on an old
 * binary) silently no-ops.
 */
export function fireHaptic(kind: HapticKind): void {
  if (Platform.OS === 'web') return
  void loadHaptics()
    .then((h) => {
      if (!h) return
      // Total over `HapticKind` — a new kind is a TYPE error here, never a
      // silent fallthrough to the wrong buzz.
      const call = ((): Promise<void> => {
        switch (kind) {
          case 'selection':
            return h.selectionAsync()
          case 'impact-light':
            return h.impactAsync(h.ImpactFeedbackStyle.Light)
          case 'impact-medium':
            return h.impactAsync(h.ImpactFeedbackStyle.Medium)
          case 'notification':
            return h.notificationAsync(h.NotificationFeedbackType.Warning)
          case 'notification-success':
            return h.notificationAsync(h.NotificationFeedbackType.Success)
          case 'notification-error':
            return h.notificationAsync(h.NotificationFeedbackType.Error)
        }
      })()
      // Swallow a native-module rejection so it never surfaces as an unhandled
      // promise rejection.
      void call.catch(() => {})
    })
    .catch(() => {})
}
