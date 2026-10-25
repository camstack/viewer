/**
 * event-haptics — pure, render-free decision logic for the timeline/live-view
 * haptic feedback feature (see {@link useEventHaptics} + {@link fireHaptic}).
 *
 * Small vibration pulses fire when a key event happens for a camera the user is
 * watching: motion start, an object detection, or a recognized person. The
 * intensity is mapped per event kind (a light tick for motion, a light impact
 * for a plain detection, a notification buzz for a person). Bursts are coalesced
 * by a global rate limit so a chatty pipeline can't machine-gun the taptic
 * engine.
 *
 * This module is intentionally React-Native-free so it unit-tests under the node
 * vitest environment (mirrors `components/camera/recorded-transport.ts`). The
 * hook is thin glue over these pure helpers; the actual `expo-haptics` calls live
 * in the RN-only `haptics-driver.ts`.
 */

/**
 * The physical haptic to play — maps 1:1 onto an `expo-haptics` call in the
 * driver (selection tick / light impact / medium impact / notification buzz of
 * a given flavour).
 *
 * This union is the WHOLE physical vocabulary of the app: both the passive
 * event pulses in this module and the press feedback in `haptics-policy.ts`
 * resolve to one of these, and `haptics-driver.ts` is the only translator into
 * `expo-haptics`. Adding a kind here means teaching the driver about it.
 */
export type HapticKind =
  | 'selection'
  | 'impact-light'
  | 'impact-medium'
  | 'notification'
  | 'notification-success'
  | 'notification-error'

/** The kind of timeline event a haptic can fire for. `motion` and `detection`
 *  reuse the highlight feature's event-kind vocabulary; `person` is the extra
 *  recognized-identity kind distinguishable client-side. */
export type HapticEventKind = 'motion' | 'detection' | 'person'

/** All configurable haptic event kinds, in display order (drives the Settings
 *  per-kind toggle rows + the config document shape). */
export const HAPTIC_EVENT_KINDS: readonly HapticEventKind[] = ['motion', 'detection', 'person']

/** Persisted haptic configuration — a global on/off plus a per-event-kind
 *  toggle, mirroring the highlight-trigger settings idiom. Lives in the settings
 *  store as the `haptics` slice. */
export interface HapticsConfig {
  /** Master switch for PASSIVE EVENT pulses: when off, no event haptic ever
   *  fires regardless of per-kind flags. Does NOT gate press feedback — see
   *  `uiFeedback`. */
  readonly enabled: boolean
  /** Vibrate on motion start (light selection tick). */
  readonly motion: boolean
  /** Vibrate on an object detection (light impact). */
  readonly detection: boolean
  /** Vibrate on a recognized person / person-class detection (notification buzz). */
  readonly person: boolean
  /**
   * PRESS FEEDBACK: the single authority for "did my tap register" vibration on
   * buttons, switches, PTZ nudges, timeline scrubs and player controls. Read
   * ONLY through `haptics-policy.ts` / `haptics.ts` — never re-derived, and
   * never a second switch (D62: a knob that disagrees with the one that owns
   * the function is worse than no knob).
   *
   * Deliberately SEPARATE from `enabled`: that one governs unsolicited pulses
   * the pipeline pushes at you (opt-in, default off), this one governs the
   * answer to something you just pressed (opt-out, default on). Folding them
   * into one flag would mean an operator who silences motion buzzing also loses
   * every button confirmation.
   */
  readonly uiFeedback: boolean
}

/**
 * Out-of-the-box haptics.
 *
 * `enabled` is the master switch for the passive EVENT pulses, and since
 * 2026-09-13 it is OFF with no way to turn it on: the operator removed the
 * settings rows and asked for the mechanism to stay — off, not gone. So the
 * per-kind flags below still describe what WOULD fire, `useEventHaptics` is
 * still wired at its call site, and nothing reaches the operator.
 *
 * Deliberately not deleted. A removed feature has to be re-implemented to come
 * back; a feature with no UI comes back by giving it one. The cost is dead
 * code that looks alive, which is why the reason is written here, next to the
 * flag, and not only in a commit message.
 *
 * `uiFeedback` is a different question and stays ON — it is the answer to
 * something you just pressed, not an unsolicited pulse, and it is the platform
 * default on both iOS and Android.
 */
export const HAPTICS_DEFAULTS: HapticsConfig = {
  enabled: false,
  motion: true,
  detection: true,
  person: true,
  uiFeedback: true,
}

/** Map a timeline event kind onto its physical haptic:
 *  motion → light selection tick, object detection → light impact,
 *  person/recognized identity → notification buzz. */
export function hapticKindForEvent(kind: HapticEventKind): HapticKind {
  switch (kind) {
    case 'motion':
      return 'selection'
    case 'detection':
      return 'impact-light'
    case 'person':
      return 'notification'
  }
}

/** Whether a given event kind is currently allowed to vibrate: the master
 *  switch AND the per-kind toggle must both be on. */
export function isHapticEventEnabled(config: HapticsConfig, kind: HapticEventKind): boolean {
  if (!config.enabled) return false
  switch (kind) {
    case 'motion':
      return config.motion
    case 'detection':
      return config.detection
    case 'person':
      return config.person
  }
}

/** Global minimum gap between haptics (ms). Bursts inside this window coalesce
 *  to a single pulse so a chatty pipeline can't machine-gun the taptic engine. */
export const HAPTIC_MIN_INTERVAL_MS = 2_000

/**
 * Whether enough time has elapsed since the last haptic to fire another. Pure —
 * `now` + `lastFiredAtMs` injected. A non-positive `lastFiredAtMs` (never fired)
 * always passes.
 */
export function canFireHaptic(
  lastFiredAtMs: number,
  nowMs: number,
  minIntervalMs: number = HAPTIC_MIN_INTERVAL_MS,
): boolean {
  if (lastFiredAtMs <= 0) return true
  return nowMs - lastFiredAtMs >= minIntervalMs
}

/**
 * Whether an `AppState` string permits firing: haptics only play while the app
 * is foreground/active (never on `background`/`inactive`).
 */
export function isForegroundActive(appState: string): boolean {
  return appState === 'active'
}

/**
 * Classify a detection frame into its haptic event kind: `person` when the frame
 * carries a recognized identity name OR a person-class box, otherwise the generic
 * `detection`. Pure — the hook supplies the already-parsed labels + recognized
 * flag from the shared `use-detections` parsers.
 */
export function detectionEventKind(
  labels: readonly string[],
  hasRecognizedName: boolean,
): HapticEventKind {
  if (hasRecognizedName) return 'person'
  if (labels.some((l) => l.toLowerCase() === 'person')) return 'person'
  return 'detection'
}

/**
 * The single haptic decision: the {@link HapticKind} to play for an event, or
 * `null` when it is gated off (config) or rate-limited. Pure — `now` +
 * `lastFiredAtMs` injected so the whole gate is unit-testable without a clock.
 */
export function resolveHaptic(
  config: HapticsConfig,
  eventKind: HapticEventKind,
  lastFiredAtMs: number,
  nowMs: number,
  minIntervalMs: number = HAPTIC_MIN_INTERVAL_MS,
): HapticKind | null {
  if (!isHapticEventEnabled(config, eventKind)) return null
  if (!canFireHaptic(lastFiredAtMs, nowMs, minIntervalMs)) return null
  return hapticKindForEvent(eventKind)
}
