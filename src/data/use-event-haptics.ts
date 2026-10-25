/**
 * useEventHaptics — fire small haptic pulses for key timeline events while the
 * user is watching one or more cameras (single camera detail or a grid).
 *
 * Wires the live event bus onto the pure decision logic in
 * `lib/event-haptics.ts`:
 *   • `motion.on-motion-changed` (detected → true) → `motion`
 *   • `detection.result` (boxes present)          → `detection` / `person`
 *   • `pipeline-analytics.frame-tracked` (names)   → `person`
 *
 * Every candidate runs through `resolveHaptic`, which applies the config gate
 * (master + per-kind toggles from the settings store) AND the global ~2s rate
 * limit (bursts coalesce to a single pulse). Guards:
 *   • native only — `Platform.OS === 'web'` opens no subscriptions,
 *   • foreground only — an `AppState` ref gates firing to the `active` state,
 *   • connected only — no subscriptions unless the hub connection is live.
 *
 * The actual vibration is delegated to the defensive `fireHaptic` driver, which
 * no-ops (never crashes) when the native module is absent (OTA on an old binary).
 */
import { useEffect, useRef } from 'react'
import { AppState, Platform, type AppStateStatus } from 'react-native'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useSettingsStore } from '../store/settings-store.js'
import { MOTION_CATEGORY, parseMotionEvent } from './use-motion.js'
import {
  DETECTION_CATEGORY,
  FRAME_TRACKED_CATEGORY,
  parseDetectionEvent,
  parseFrameTrackedEvent,
  type DetectionBox,
} from './use-detections.js'
import {
  detectionEventKind,
  resolveHaptic,
  type HapticEventKind,
  type HapticsConfig,
} from '../lib/event-haptics.js'
import { fireHaptic } from '../lib/haptics-driver.js'

/** Boxes → (labels, hasRecognizedName) for `detectionEventKind`. */
function classifyBoxes(boxes: readonly DetectionBox[]): HapticEventKind {
  const labels = boxes.map((b) => b.label)
  const hasName = boxes.some((b) => typeof b.name === 'string' && b.name.length > 0)
  return detectionEventKind(labels, hasName)
}

/**
 * Subscribe to the live event bus for `deviceIds` and vibrate on qualifying
 * events, per the user's haptics config. A no-op when `enabled` is false, on
 * web, when the master haptics toggle is off, or when disconnected.
 */
export function useEventHaptics(deviceIds: readonly number[], enabled: boolean): void {
  const { controller, state: connState } = useConnection()
  const haptics: HapticsConfig = useSettingsStore((s) => s.settings.haptics)

  // Stable device-id set for the effect (avoids re-subscribing on array identity
  // churn — the key is the sorted membership).
  const deviceKey = [...deviceIds].sort((a, b) => a - b).join(',')

  // Last-fired timestamp (global rate-limit state) + live AppState, both in refs
  // so the subscription callbacks read current values without re-subscribing.
  const lastFiredAtRef = useRef(0)
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)

  const active =
    enabled &&
    haptics.enabled &&
    Platform.OS !== 'web' &&
    connState === 'connected' &&
    deviceKey.length > 0

  useEffect(() => {
    if (Platform.OS === 'web') return
    const sub = AppState.addEventListener('change', (next) => {
      appStateRef.current = next
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!active) return
    const system = controller.getSystem()
    if (!system) return

    const ids = new Set(deviceKey.split(',').map((s) => Number(s)))

    /** Run one candidate event through the pure gate + rate limit, and fire. */
    const consider = (kind: HapticEventKind): void => {
      if (appStateRef.current !== 'active') return
      const now = Date.now()
      const decided = resolveHaptic(haptics, kind, lastFiredAtRef.current, now)
      if (!decided) return
      lastFiredAtRef.current = now
      fireHaptic(decided)
    }

    const unsubMotion = system.subscribeEvent(MOTION_CATEGORY, (event: unknown) => {
      const parsed = parseMotionEvent(event)
      // Only the rising edge (motion START) — not the drop.
      if (!parsed || !parsed.detected || !ids.has(parsed.deviceId)) return
      consider('motion')
    })

    const unsubDetection = system.subscribeEvent(DETECTION_CATEGORY, (event: unknown) => {
      const parsed = parseDetectionEvent(event)
      if (!parsed || parsed.boxes.length === 0) return
      if (!ids.has(Number(parsed.sourceId))) return
      consider(classifyBoxes(parsed.boxes))
    })

    const unsubTracked = system.subscribeEvent(FRAME_TRACKED_CATEGORY, (event: unknown) => {
      const parsed = parseFrameTrackedEvent(event)
      if (!parsed || parsed.boxes.length === 0 || !ids.has(parsed.deviceId)) return
      consider(classifyBoxes(parsed.boxes))
    })

    return () => {
      unsubMotion()
      unsubDetection()
      unsubTracked()
    }
    // `haptics` is intentionally a dep so a config change re-binds the closure
    // with the new gate; the rate-limit ref survives across re-subscribes.
  }, [controller, active, deviceKey, haptics])
}
