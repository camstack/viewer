/**
 * haptics-policy — the pure decision layer for PRESS feedback (the short buzz
 * that answers a tap on a button, switch, PTZ nudge, timeline scrub or player
 * control).
 *
 * Two rules, and they are the reason this module exists at all:
 *
 *  1. **Callers speak SEMANTICS, never physics.** A component asks for a `tap`
 *     or an `action`; it never picks a `Haptics.ImpactFeedbackStyle`. That is
 *     what keeps the whole app feeling like one device instead of forty
 *     independently-tuned buttons — retuning "what an important action feels
 *     like" is one edit to {@link hapticKindForIntent}, not forty.
 *  2. **One authority decides whether anything fires at all.** That authority
 *     is `HapticsConfig.uiFeedback`, read here and nowhere else (D62). No
 *     surface keeps its own "should I vibrate" flag.
 *
 * Kept React-Native-free so it unit-tests under the node vitest environment;
 * `haptics.ts` is the thin imperative glue that reads the store and calls the
 * driver, and `haptics-driver.ts` is the only module that touches
 * `expo-haptics`.
 */
import type { HapticKind, HapticsConfig } from './event-haptics.js'

/**
 * What a press MEANS — the only vocabulary components use.
 *
 *  • `tap`     — an ordinary press: a toggle, a chip, a PTZ nudge, a tile.
 *  • `action`  — a consequential press: arm/disarm, a function switch (D62),
 *                a siren, a lock, a destructive confirm. Weightier on purpose,
 *                so "I just changed something real" is felt, not just seen.
 *  • `detent`  — not a press at all: the cursor CROSSED something during a
 *                continuous gesture (a cluster on the timeline), like an iOS
 *                picker notch. Edge-triggered and rate-limited by
 *                `scrub-detent.ts`; never fired per gesture frame.
 *  • `success` — an operation RESOLVED well (a write landed).
 *  • `error`   — an operation FAILED (a write was refused).
 *
 * `success`/`error` are outcomes, not presses: fire them when the answer
 * arrives, never optimistically alongside the `tap` that started the work.
 *
 * ── Navigation: silent, with two named exceptions ────────────────────────────
 *
 * Moving between screens does not buzz. Feedback on every push would be
 * constant and would stop distinguishing the presses that DO something.
 *
 * Three places are exempt, all by explicit operator request, and all listed
 * here rather than argued at the call site so the rule stays checkable:
 *
 *  1. **Opening a camera from the Cameras list.** It is the primary action of
 *     the whole app — the thing the app is FOR — not incidental traversal.
 *  2. **Switching top-level tab from the bottom bar.** The platform convention
 *     on iOS, and the one navigation the operator performs blind, by thumb
 *     position. Only when the tab actually CHANGES: re-tapping the active tab
 *     does nothing here (expo-router skips `switchTab` when already focused)
 *     and so is silent. If a scroll-to-top-on-re-tap is ever added, it becomes
 *     a real action and should fire its own `tap`.
 *  3. **The player's back arrow** (`TimelineToolbarInline`). The one back
 *     button that is not a back button: it sits in the theater toolbar among
 *     the day-nav and quality controls, every one of which pulses, and it is
 *     pressed while the operator is looking at the video rather than at the
 *     control. A silent arrow in a row of answering ones read as a dead
 *     button. Held by
 *     `components/camera/theater/__tests__/toolbar-back-haptic.spec.ts` —
 *     which asserts the NATIVE call, so deleting the `hapticTap()` there goes
 *     red rather than quiet.
 *
 * Anything else that merely navigates — the grid's back chip, the swipe-back
 * gesture, opening a panel or a sheet, a menu that only reveals options —
 * stays silent. In particular the shared `navigation/back-to-cameras.ts`
 * helper fires NOTHING: three of its four callers are not a button press, and
 * a haptic in there would both buzz an ungestured dismissal and double-buzz
 * the arrow above.
 */
export type UiHapticIntent = 'tap' | 'action' | 'detent' | 'success' | 'error'

/** Every intent, for exhaustiveness tests and guards. */
export const UI_HAPTIC_INTENTS: readonly UiHapticIntent[] = [
  'tap',
  'action',
  'detent',
  'success',
  'error',
]

/**
 * The one intent → physical-kind table. Deliberately total over the union (a
 * `switch` with no `default`, so adding an intent is a TYPE error here rather
 * than a silent no-vibration in production).
 */
export function hapticKindForIntent(intent: UiHapticIntent): HapticKind {
  switch (intent) {
    case 'tap':
      return 'impact-light'
    case 'action':
      return 'impact-medium'
    case 'detent':
      // `selectionAsync` — literally the picker-wheel tick, and the right
      // answer on BOTH platforms rather than a branch: iOS gives the taptic
      // selection click, Android the CLOCK_TICK-class effect. Both are crisper
      // and cheaper than a light impact, which is what a notch should feel
      // like when dozens go past in a single drag.
      return 'selection'
    case 'success':
      return 'notification-success'
    case 'error':
      return 'notification-error'
  }
}

/**
 * Whether press feedback may fire at all. The SINGLE gate — independent of the
 * passive event-haptics master switch (`config.enabled`), which governs
 * unsolicited pulses and must not silence a button's answer to a touch.
 */
export function isUiHapticEnabled(config: HapticsConfig): boolean {
  return config.uiFeedback
}

/**
 * The one press-feedback decision: the {@link HapticKind} to play, or `null`
 * when the user has switched press feedback off.
 *
 * Note what is deliberately ABSENT: the rate limit that guards event haptics
 * (`HAPTIC_MIN_INTERVAL_MS`). A pulse the pipeline pushes at you can machine-gun
 * the taptic engine; a press cannot — it is bounded by the human doing the
 * pressing, and coalescing it would make rapid PTZ nudges feel dead exactly
 * when the operator most needs to know the button took.
 */
export function resolveUiHaptic(
  config: HapticsConfig,
  intent: UiHapticIntent,
): HapticKind | null {
  if (!isUiHapticEnabled(config)) return null
  return hapticKindForIntent(intent)
}
