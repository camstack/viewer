/**
 * scroll-scrub-gesture — the pure gesture→command mapping for the timeline
 * SCROLL scrub.
 *
 * A ScrollView-driven scrub has no discrete "release" event on every platform,
 * so the previous implementation committed on a stationary DEBOUNCE ("commit
 * once the timeline has stayed still ~220 ms"). Under feeder-scrub that fired a
 * real server seek MID-DRAG every time the drag paused or the scroll events
 * gapped — each commit tore down the feeder's scrub mode and the embed re-entered
 * scrub (the repeated `scrubStart` → stutter the operator saw).
 *
 * This reducer removes ALL mid-drag commits: a `frame` only ever emits
 * `begin`/`move`; a `commit` is emitted EXACTLY ONCE, on `end` — the gesture
 * RELEASE, supplied by the component from `onScrollEndDrag` (or a web-wheel idle
 * settle, where no release event exists). `liveEdge` drops an in-progress scrub
 * WITHOUT a commit (scrolling into the live edge goes live, it never seeks to
 * ~now).
 *
 * Pure (no React / no timers) so the begin-once / move / commit-only-on-`end`
 * invariant is unit-tested directly; the component owns the impure event plumbing
 * (epoch mapping, live-edge math, momentum disambiguation, timers).
 */

export interface ScrubGestureState {
  /** A scrub is in progress: begun, not yet committed. */
  readonly active: boolean
  /** The latest previewed epoch — committed verbatim on `end`. `null` ⟺ idle. */
  readonly lastEpoch: number | null
}

export const idleScrubGesture: ScrubGestureState = { active: false, lastEpoch: null }

/** The px→time mapping decision that produced a frame's epoch (see
 *  `utils/drag-mapping.ts`). Pass-through payload: the reducer never reads it. */
export interface ScrubFrameHint {
  readonly mode: 'fine' | 'coarse'
  readonly velocityPxPerS: number
}

export type ScrubGestureInput =
  | { readonly kind: 'frame'; readonly epoch: number; readonly hint?: ScrubFrameHint }
  | {
      readonly kind: 'liveEdge'
      /**
       * An export selection is armed.
       *
       * The selection's free end may be dragged FORWARD ("from two hours ago
       * until one hour ago"), which walks the list straight into the live-edge
       * band. Going live there would clear the anchor — `GO_LIVE` drops it on
       * purpose, since an anchor in footage the operator has left is not a
       * range anyone asked to export — so the range they were drawing would
       * vanish under their finger at the one moment they were reaching for its
       * far end.
       *
       * While it is armed the live edge is a WALL: no command at all, the scrub
       * stays active, and the free end simply stops there. The Go-live BUTTON
       * is untouched — that one is a deliberate press, and it still ends the
       * selection.
       */
      readonly armedSelection: boolean
    }
  | { readonly kind: 'end' }

export type ScrubGestureCommand =
  | { readonly kind: 'begin' }
  | { readonly kind: 'move'; readonly epoch: number; readonly hint?: ScrubFrameHint }
  | { readonly kind: 'commit'; readonly epoch: number }
  | { readonly kind: 'goLive' }

export interface ScrubGestureResult {
  readonly state: ScrubGestureState
  readonly commands: readonly ScrubGestureCommand[]
}

/**
 * Fold one gesture input into the scrub state and the commands it produces.
 *
 *   • frame    → begins the scrub on the FIRST frame (begin + move), else move.
 *                NEVER commits — a mid-drag frame can no longer reach the server.
 *   • liveEdge → goLive, dropping any in-progress scrub WITHOUT committing it.
 *                Except while a selection is armed, where it is a no-op and the
 *                drag continues — see `armedSelection`.
 *   • end      → the SINGLE commit point (the final `lastEpoch`). Idempotent: an
 *                `end` with no active scrub (release after a goLive, or a
 *                duplicate momentum/idle end) is a no-op.
 */
export function reduceScrubGesture(
  state: ScrubGestureState,
  input: ScrubGestureInput,
): ScrubGestureResult {
  switch (input.kind) {
    case 'frame': {
      if (!state.active) {
        return {
          state: { active: true, lastEpoch: input.epoch },
          commands: [{ kind: 'begin' }, { kind: 'move', epoch: input.epoch, hint: input.hint }],
        }
      }
      return {
        state: { ...state, lastEpoch: input.epoch },
        commands: [{ kind: 'move', epoch: input.epoch, hint: input.hint }],
      }
    }
    case 'liveEdge':
      if (input.armedSelection) return { state, commands: [] }
      return { state: idleScrubGesture, commands: [{ kind: 'goLive' }] }
    case 'end': {
      if (!state.active || state.lastEpoch === null) {
        return { state: idleScrubGesture, commands: [] }
      }
      return { state: idleScrubGesture, commands: [{ kind: 'commit', epoch: state.lastEpoch }] }
    }
  }
}
