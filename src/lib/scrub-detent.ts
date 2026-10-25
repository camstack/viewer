/**
 * scrub-detent — the pure model behind the timeline's DETENT tick: a single
 * short pulse each time the scrub cursor crosses onto a new cluster, like the
 * notches of an iOS picker wheel.
 *
 * This is deliberately NOT "vibrate while scrubbing". A drag reports its
 * position on every scroll frame, and firing there would machine-gun the taptic
 * engine — which is exactly why `onScrubMove` has no haptic of its own. What
 * the operator feels here is the CONTENT going past, not the finger moving:
 * the pulse is EDGE-TRIGGERED on the identity of whatever sits under the
 * cursor, so a slow drag across one fat cluster buzzes once, and a fast flick
 * across ten buzzes at most as often as the rate limit allows.
 *
 * The state is a key plus the last real tick's timestamp, and the key is a
 * plain `string | null` so ONE reducer serves both timelines:
 *
 *  • the theater timeline keys on the nearest cluster id
 *    (`nearestClusterId` in `cluster-proximity.ts`, which already owns the
 *    cursor↔cluster distance in zoom-invariant pixels);
 *  • the grid timeline keys on the SET of cameras with an event under the
 *    cursor ({@link detentKeyForIds}) — the grid has lanes, not clusters, and
 *    "which cameras are lit right now" is its equivalent fact.
 *
 * React-Native-free so it unit-tests under the node vitest environment; the
 * caller injects `now`, so the whole gate is testable without a clock.
 */

/** Cursor-position state between two scrub frames. */
export interface DetentState {
  /** What sits under the cursor, or null for empty track. */
  readonly key: string | null
  /** When the last pulse actually FIRED (not when one was suppressed). */
  readonly lastTickMs: number
}

/** Nothing under the cursor, nothing ever fired. */
export const DETENT_INITIAL: DetentState = { key: null, lastTickMs: 0 }

/**
 * Floor between two pulses.
 *
 * It was 80 ms, chosen as the point where consecutive taps stop reading as
 * separate events. That is the threshold for telling two pulses APART, and
 * using it as the floor is what put the cadence AT it: a drag across a dense
 * hour fired one every 80 ms — **12.5 a second**, ~25 across a two-second drag.
 * The operator reported it twice. The first time it was read as a
 * selection-only problem and silenced there (`detentKeyWhileScrubbing`); on
 * 2026-09-10 he reported the same buzz while simply scrubbing to FIND the
 * start of an export, which is not a selection and was never silenced.
 *
 * A detent is meant to be felt as clicks, so the floor is the cadence you want
 * at the densest moment, not the fastest one distinguishable. Five a second is
 * a hand-feel decision, and it is the operator's to overrule.
 */
export const DETENT_MIN_INTERVAL_MS = 200

/** The reducer's answer: the next state, and whether to pulse now. */
export interface DetentDecision {
  readonly state: DetentState
  readonly tick: boolean
}

/**
 * Decide whether crossing onto `nextKey` should pulse.
 *
 * Rules, in order:
 *  1. **Same key → nothing.** The common case, hit on every frame of a drag
 *     that has not left the current cluster.
 *  2. **Onto empty track → nothing, but remember it.** Leaving is not an
 *     event; only arriving is. Clearing the key is what makes a RE-ENTRY into
 *     the same cluster pulse again.
 *  3. **Onto a new cluster → pulse, unless too soon.** A suppressed crossing
 *     still ADVANCES the key (the cursor really is somewhere else now) but
 *     deliberately does NOT move `lastTickMs` — the window is measured from
 *     the last pulse the user actually felt, so a flurry of fast crossings
 *     cannot push the next real pulse indefinitely into the future.
 */
export function resolveDetent(
  prev: DetentState,
  nextKey: string | null,
  nowMs: number,
  minIntervalMs: number = DETENT_MIN_INTERVAL_MS,
): DetentDecision {
  if (nextKey === prev.key) return { state: prev, tick: false }
  if (nextKey === null) return { state: { key: null, lastTickMs: prev.lastTickMs }, tick: false }
  if (nowMs - prev.lastTickMs < minIntervalMs) {
    return { state: { key: nextKey, lastTickMs: prev.lastTickMs }, tick: false }
  }
  return { state: { key: nextKey, lastTickMs: nowMs }, tick: true }
}

/**
 * The theater timeline's detent key: whatever is under the cursor — or SILENCE
 * while an export selection is armed.
 *
 * The pulse means "the cursor just crossed an event", which is what an operator
 * HUNTING for something needs. Drawing an export range is the other task: its
 * two ends are instants, and the events between them are what the operator is
 * INCLUDING rather than looking for, so every pulse answers a question nobody
 * asked. With the 80 ms floor a drag across a dense hour fires one every 80 ms
 * — 12.5 a second, ~25 across a two-second drag — which is the "vibration at
 * every micro-step" the operator reported. The right number while selecting is
 * not a higher floor but zero.
 *
 * `nearest` is a THUNK so the silence also skips the work: on the theater
 * timeline it walks every cluster of the day, per emitted sample.
 *
 * Returning `null` rather than short-circuiting the reducer is deliberate — it
 * is the module's existing "empty track" case, so the key is cleared and a
 * re-entry after the selection ends pulses again (rule 2 in {@link
 * resolveDetent}).
 */
export function detentKeyWhileScrubbing(
  selectionArmed: boolean,
  nearest: () => string | null,
): string | null {
  if (selectionArmed) return null
  return nearest()
}

/**
 * A stable detent key for the set of device ids under the grid cursor, or null
 * when none are.
 *
 * Sorted and deduplicated on purpose: the caller builds this by walking lanes,
 * so encounter order follows the data and a raw join would mint a different
 * key for the same set — which the reducer would read as a crossing and pulse
 * on every single frame, the precise failure this module exists to prevent.
 */
export function detentKeyForIds(deviceIds: Iterable<number>): string | null {
  const unique = [...new Set(deviceIds)]
  if (unique.length === 0) return null
  return unique.sort((a, b) => a - b).join(',')
}
