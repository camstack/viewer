/**
 * haptics — THE press-feedback API. Every button, switch, PTZ nudge, timeline
 * scrub and player control in the app calls one of these three functions and
 * nothing else.
 *
 * The layering, and why it has three files instead of one:
 *
 *   components  →  haptics.ts        (semantic: "this was a tap")
 *                  haptics-policy.ts (pure decision — unit tested, node-safe)
 *                  haptics-driver.ts (the ONLY `expo-haptics` import)
 *
 * A component never picks an impact style, never reads the settings store for
 * a vibration flag, and never imports the driver: it says what the press MEANT
 * and this module decides whether and how the device answers. That is what
 * makes the user's "Vibration" switch a real authority (D62) rather than a
 * suggestion forty call sites are free to ignore — and it is enforced by
 * `scripts/check-haptics-imports.mjs`, not just by this comment.
 *
 * Fire-and-forget throughout: never awaited, never throws, silently no-ops on
 * web and on a native binary that predates `expo-haptics`.
 */
import { useSettingsStore } from '../store/settings-store.js'
import { fireHaptic } from './haptics-driver.js'
import { resolveUiHaptic, type UiHapticIntent } from './haptics-policy.js'

/**
 * Resolve the intent against the user's CURRENT setting and play it.
 *
 * Reads the store imperatively (`getState`) rather than through a hook on
 * purpose: these are called from event handlers, including ones inside
 * `useCallback`s and gesture worklet callbacks where a hook cannot go — and
 * reading at press time means a setting change takes effect on the very next
 * press with no re-render or subscription anywhere.
 */
function fire(intent: UiHapticIntent): void {
  const kind = resolveUiHaptic(useSettingsStore.getState().settings.haptics, intent)
  if (kind === null) return
  fireHaptic(kind)
}

/**
 * An ORDINARY press registered: a toggle, a chip, a tile, a PTZ nudge, a
 * timeline event pick, a player control. Light and cheap — this is the default
 * and should be the overwhelming majority of call sites.
 */
export function hapticTap(): void {
  fire('tap')
}

/**
 * A CONSEQUENTIAL press registered: arm/disarm, a per-camera function switch
 * (D62), a siren, a lock, a destructive confirm. Weightier than a tap so the
 * difference is felt, not merely read.
 *
 * Use sparingly. If everything is an action, nothing is.
 */
export function hapticAction(): void {
  fire('action')
}

/**
 * The scrub cursor CROSSED onto something — a timeline cluster going past
 * under the finger, like an iOS picker notch.
 *
 * Not a press: this is the only entry point here that a continuous gesture may
 * call, and it is safe only because the caller has already decided the crossing
 * is real. Always drive it from `resolveDetent` in `scrub-detent.ts`, which is
 * edge-triggered and rate-limited — calling this per gesture frame would be the
 * machine-gun the whole design avoids.
 */
export function hapticDetent(): void {
  fire('detent')
}

/**
 * An operation RESOLVED. Fire when the answer actually arrives (a mutation
 * settled), never optimistically next to the `hapticTap` that started it —
 * otherwise a refusal feels identical to a success, which is precisely the
 * signal this exists to carry.
 */
export function hapticResult(success: boolean): void {
  fire(success ? 'success' : 'error')
}
