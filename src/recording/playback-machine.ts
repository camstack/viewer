/**
 * playback-machine — the SINGLE owner of the playhead + live/playback mode for
 * one camera-detail instance.
 *
 * Replaces the three overlapping position writers (the scrub-controller reducer,
 * the CameraDetailScreen `playheadEpoch`/`playbackMode` useState pair, and the
 * TheaterTimeline scroll-derived `isLive`). ONE reducer owns everything; the
 * passive position poller is SUBORDINATE to `mode`:
 *
 *   • live      — the live edge is rendered from a wall-clock, NEVER the poller;
 *                 `playhead === null`. Position reports are ignored (bug #2:
 *                 a stray/late report can no longer flip live → playback).
 *   • seeking   — a drag is in flight; `seekTarget` previews it. Reports ignored.
 *   • playback  — recorded playback. A SEEK/COMMIT arms `seekAnchor`; a poller
 *                 report only advances the playhead once one lands within
 *                 tolerance of the anchor (bug #3: pre-seek near-live stragglers
 *                 are DROPPED, timer-free — no navLock/wall-clock).
 *   • gap/error — adopted from the embed only while already in playback.
 *
 * Two layers (mirrors scrub-controller):
 *   1. Pure reducer + helpers (unit-tested, no React deps).
 *   2. usePlaybackMachine hook: thin React glue over a `PlaybackControlSink`.
 *
 * Per-camera-instance state → this is a hook-local `useReducer`, NOT a global
 * store (a store would leak one camera's playhead into another).
 */
import { useMemo, useReducer, useRef } from 'react'
import { scrubDragStarted } from './scrub-first-frame.js'
import { generateDragId } from './scrub-drag-id.js'
import { log } from '../lib/logger.js'
import {
  derivePlaybackStatus,
  type PlaybackMode as EmbedPlaybackMode,
  type PlaybackStatus,
} from './playback-status.js'
import { resolveScrubDirection, type ScrubDirection } from './scrub-direction.js'
import { PLAYER_SCRUB_EMIT_MS, shouldEmitScrubSample } from '../lib/scrub-throttle.js'

// ── Types ────────────────────────────────────────────────────────────────────

/** The machine's mode. Distinct from the EMBED's reported mode
 *  (`EmbedPlaybackMode` from playback-status: live/loading/playing/paused/gap/error). */
export type PlaybackMode = 'live' | 'seeking' | 'playback' | 'gap' | 'error'


export type ScrubSource = 'timeline' | 'heatmap' | 'cluster'

export interface PlaybackState {
  readonly mode: PlaybackMode
  /** Epoch ms. `null` ⟺ live (the live edge is rendered from wall-clock now,
   *  never from the poller). */
  readonly playhead: number | null
  /** Drag preview epoch while `mode === 'seeking'`, else null. */
  readonly seekTarget: number | null
  /** Epoch a SEEK/COMMIT asked the server for; null once a report has landed. */
  readonly seekAnchor: number | null
  /** True once a poller report landed within tolerance of `seekAnchor`. */
  readonly seekLanded: boolean
  /**
   * How many position reports have been REJECTED as pre-seek stragglers since
   * the anchor was armed.
   *
   * The straggler window is bounded by the round trip, not by distance — see
   * {@link MAX_STRAGGLER_REPORTS}.
   */
  readonly stragglerReports: number
  readonly lastSource: ScrubSource | null
  /**
   * Which way through time the live drag is heading — folded from the SAME
   * retarget that replaces `seekTarget`, never from a second reading of the
   * gesture. Null outside a drag, and during the first move of one that started
   * at the live edge (there is nothing to measure against yet).
   *
   * Read through {@link selectScrubDirection}, which is what the play/pause
   * button swaps its glyph on.
   */
  readonly scrubDirection: ScrubDirection | null
  /**
   * The LIVE LOCK: the operator browses the timeline without taking the
   * picture with them.
   *
   * While it is armed every gesture still retargets `seekTarget` — the visible
   * position follows the finger, the day window re-windows, the heatmap cursor
   * moves — but NOTHING moves the player: `mode`, `playhead` and `seekAnchor`
   * are left exactly where they were, and the bridge withholds the sink calls.
   * `GO_LIVE` is the one command that still reaches the player, so the way back
   * to the live edge is never blocked.
   *
   * Per camera-detail instance and OFF by default: this is the hook-local
   * reducer's state, not a store, for the same reason the playhead is.
   */
  readonly liveLocked: boolean
  /**
   * The EXPORT SELECTION's fixed end, or null when no selection is armed.
   *
   * A selection is a state of THIS machine and not a second one, because its
   * moving end is the playhead's own preview: the anchor is the only fact the
   * machine did not already hold. A parallel reducer owning "where the operator
   * is looking" would be a second description of the pointer, and the two would
   * drift — the band drawn on the timeline would stop matching the range that
   * gets exported.
   *
   * While it is set, every navigation gesture behaves exactly as it does under
   * the live lock: it retargets `seekTarget` and NOTHING moves the player. The
   * difference is which picture is being held. Locked, the player is on the
   * live edge; selecting, it is on the last scrub frame the server pushed —
   * `recorded-track-session.ts` holds that keyframe on the track until a commit
   * lands, so withholding the commit IS "show the last frame reached and do not
   * start playback". That behaviour is native to scrub; this preserves it.
   *
   * Armed only off the live edge — see `SELECTION_BEGIN`.
   */
  readonly selectionAnchor: number | null
}

export const initialPlaybackState: PlaybackState = {
  mode: 'live',
  playhead: null,
  seekTarget: null,
  seekAnchor: null,
  seekLanded: false,
  stragglerReports: 0,
  lastSource: null,
  scrubDirection: null,
  liveLocked: false,
  selectionAnchor: null,
}

export type PlaybackAction =
  | { readonly type: 'SCRUB_BEGIN'; readonly source: ScrubSource }
  | { readonly type: 'SCRUB_MOVE'; readonly epoch: number; readonly source: ScrubSource }
  | { readonly type: 'SCRUB_COMMIT'; readonly epoch: number; readonly source: ScrubSource }
  | { readonly type: 'SEEK'; readonly epoch: number; readonly source: ScrubSource }
  | { readonly type: 'GO_LIVE' }
  | { readonly type: 'POSITION_REPORT'; readonly epoch: number }
  | { readonly type: 'EMBED_STATE'; readonly embed: EmbedPlaybackMode }
  | { readonly type: 'SET_LIVE_LOCK'; readonly locked: boolean }
  /** Arm the export selection at `epoch`. Ignored at the live edge. */
  | { readonly type: 'SELECTION_BEGIN'; readonly epoch: number }
  /** Drop it — both Save and Discard end here. Leaves the playhead alone. */
  | { readonly type: 'SELECTION_END' }
  /**
   * The screen swapped to a DIFFERENT camera in place (D483).
   *
   * `atMs` is the instant the new camera opens at — the moment the operator was
   * already looking at — or `null` when the old camera was live.
   *
   * ## Why this is its own action and not `GO_LIVE` + `adoptSeek`
   *
   * Two reasons, and the second is a latent bug the audit for this change
   * found. `GO_LIVE` is not a full reset: it deliberately keeps `liveLocked`
   * and `lastSource`, because leaving a recording is not the same as starting
   * over. And `adoptSeek` dispatches `SEEK`, which is BLOCKED into a
   * preview-only update when `liveLocked` is armed or a selection is open — so
   * seeding a locked machine would silently move the indicator and leave `mode`
   * on `live`, and the new camera would show the live edge while the timeline
   * claimed otherwise.
   *
   * One atomic action has no ordering hazard and no dependence on the state it
   * is replacing, which is the whole point of a reset.
   *
   * ## Reset AND seed, never reuse
   *
   * Every field starts from {@link initialPlaybackState} — the machine is per
   * camera-instance precisely so one camera's playhead cannot leak into
   * another's, and until now a route remount enforced that for free. What makes
   * the seeded instant legitimate rather than a leak is that it arrives as an
   * ARGUMENT: the gesture means "camera B at the moment I am looking at". A
   * playhead that survived by accident is still the defect.
   */
  | { readonly type: 'SWAP_CAMERA'; readonly atMs: number | null }

/** How close (ms) a poller report must be to the seek anchor to count as "the
 *  seek landed". A pre-seek near-live straggler is far from the anchor → dropped. */
export const RECONCILE_TOLERANCE_MS = 1500

/**
 * How many out-of-tolerance reports to reject before ADOPTING the position.
 *
 * The rejection exists to drop reports still in flight from BEFORE the seek.
 * Those are bounded by the round trip — one or two reports at the ~1 Hz
 * position cadence — NOT by how far away they are. Rejecting on distance alone
 * is what froze the indicator: measured on 2026-08-01, camera 101, the operator
 * sought a moment with no footage and the feeder legitimately snapped to the
 * nearest segment 151 s and 251 s away. Every report was then further than
 * 1500 ms from the anchor, so every report was dropped as a straggler,
 * `seekLanded` never became true, and the indicator sat frozen on the REQUESTED
 * time while the stream played the one the server had actually landed on:
 *
 *   deltaMs -251145 / -151519, indicatorEpoch === seekAnchor, seekLanded false
 *
 * After this many rejections the server has plainly landed somewhere else on
 * purpose, and its answer is the truth.
 */
export const MAX_STRAGGLER_REPORTS = 3

// ── Pure reducer ─────────────────────────────────────────────────────────────

/**
 * The POSITION_REPORT reconciliation — the timer-free bug-#3 killer.
 *
 *   if mode !== 'playback'   → return state (live/seeking own the playhead)
 *   if seekAnchor === null   → advance the playhead (free-running playback)
 *   if !seekLanded:
 *     within tolerance       → land: adopt, mark landed, clear anchor
 *     else, still in the straggler window → DROP (a report from before the seek)
 *     else                   → ADOPT anyway: the server landed elsewhere on
 *                              purpose (no footage at the requested moment, so
 *                              the feeder snapped to the nearest segment), and
 *                              its position is the truth however far it is.
 */
function reconcilePosition(state: PlaybackState, epoch: number): PlaybackState {
  if (state.mode !== 'playback') return state
  if (state.seekAnchor === null) return { ...state, playhead: epoch }
  if (!state.seekLanded) {
    if (Math.abs(epoch - state.seekAnchor) <= RECONCILE_TOLERANCE_MS) {
      return {
        ...state,
        playhead: epoch,
        seekLanded: true,
        seekAnchor: null,
        stragglerReports: 0,
      }
    }
    // Bounded by TIME (reports), not by distance. Rejecting purely on distance
    // never terminates when the server has genuinely landed far away.
    if (state.stragglerReports + 1 >= MAX_STRAGGLER_REPORTS) {
      return {
        ...state,
        playhead: epoch,
        seekLanded: true,
        seekAnchor: null,
        stragglerReports: 0,
      }
    }
    return { ...state, stragglerReports: state.stragglerReports + 1 }
  }
  return state
}

/**
 * EMBED_STATE adoption: the embed reports gap/error/live/loading/playing/paused.
 *   • 'gap'|'error' → adopt ONLY while already in playback (still recorded).
 *   • 'live'        → NEVER override a user seek.
 *   • everything else (loading/playing/paused) → unchanged.
 */
function adoptEmbedState(state: PlaybackState, embed: EmbedPlaybackMode): PlaybackState {
  if ((embed === 'gap' || embed === 'error') && state.mode === 'playback') {
    return { ...state, mode: embed }
  }
  return state
}

/**
 * A navigation action that must move the PREVIEW and nothing else: `mode`,
 * `playhead` and `seekAnchor` stay exactly where the player is. No anchor is
 * armed either, because no seek was issued — arming one would make the next
 * position report look like a straggler for a seek that never happened.
 *
 * Two states take this path, for the same reason from opposite ends: the LIVE
 * LOCK (browse the recording without taking the picture off live) and an armed
 * EXPORT SELECTION (move the selection's free end without landing playback).
 *
 * `epoch === null` is the start of a drag, which has no target yet.
 */
function previewOnly(
  state: PlaybackState,
  epoch: number | null,
  source: ScrubSource,
): PlaybackState {
  return {
    ...state,
    seekTarget: epoch,
    lastSource: source,
    // The direction arrow belongs to a drag that is DRIVING the player. Locked,
    // the play/pause button keeps controlling the live picture, so it keeps its
    // glyph (and stays enabled — see `selectScrubDirection`).
    scrubDirection: null,
  }
}

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case 'SCRUB_BEGIN':
      if (state.liveLocked || state.selectionAnchor !== null)
        return previewOnly(state, null, action.source)
      return {
        ...state,
        mode: 'seeking',
        seekTarget: null,
        lastSource: action.source,
        scrubDirection: null,
      }

    case 'SCRUB_MOVE':
      if (state.liveLocked || state.selectionAnchor !== null)
        return previewOnly(state, action.epoch, action.source)
      return {
        ...state,
        mode: 'seeking',
        seekTarget: action.epoch,
        lastSource: action.source,
        // The reference is the target this drag last asked for, falling back to
        // the position it started from — so a drag off a recorded playhead has
        // a direction from move ONE, while one begun at the live edge (playhead
        // null) honestly has none until the second.
        scrubDirection: resolveScrubDirection(
          state.seekTarget ?? state.playhead,
          action.epoch,
          state.scrubDirection,
        ),
      }

    case 'SCRUB_COMMIT':
    case 'SEEK':
      // The release KEEPS the browsed position: dropping it here would snap the
      // indicator back to the live edge while the list stayed where the
      // operator left it.
      //
      // Exception: a cluster tap (an event) is an explicit "play this
      // recording" — the live lock is for browsing the timeline without
      // taking the picture off live, not for blocking event playback.
      // An armed selection holds for EVERY source, the cluster tap included:
      // there, picking an event is picking the selection's other end, not an
      // order to play it.
      if (state.selectionAnchor !== null) {
        return previewOnly(state, action.epoch, action.source)
      }
      if (state.liveLocked && action.source !== 'cluster') {
        return previewOnly(state, action.epoch, action.source)
      }
      return {
        ...state,
        liveLocked: action.source === 'cluster' ? false : state.liveLocked,
        mode: 'playback',
        playhead: action.epoch,
        seekTarget: null,
        seekAnchor: action.epoch,
        seekLanded: false,
        stragglerReports: 0,
        lastSource: action.source,
        scrubDirection: null,
      }

    case 'SWAP_CAMERA':
      // Built from `initialPlaybackState`, not from `state`: a field added to
      // the machine later is reset by default rather than silently carried onto
      // the next camera. The seeded shape mirrors what a real `SEEK` produces,
      // because the embed performs the seek itself (the instant rides the
      // `setDevice` command) and the machine is adopting it, not ordering it.
      return action.atMs === null
        ? initialPlaybackState
        : {
            ...initialPlaybackState,
            mode: 'playback',
            playhead: action.atMs,
            seekAnchor: action.atMs,
            lastSource: 'timeline',
          }

    case 'GO_LIVE':
      return {
        ...state,
        // Leaving the recording cannot leave a selection behind: its anchor is
        // an epoch in footage the operator is no longer looking at, and a Save
        // button surviving the trip home would export it.
        selectionAnchor: null,
        mode: 'live',
        playhead: null,
        seekTarget: null,
        seekAnchor: null,
        seekLanded: false,
        stragglerReports: 0,
        scrubDirection: null,
      }

    case 'POSITION_REPORT':
      return reconcilePosition(state, action.epoch)

    case 'EMBED_STATE':
      return adoptEmbedState(state, action.embed)

    case 'SET_LIVE_LOCK':
      // Either way the preview goes: armed, it has not been browsed anywhere
      // yet; disarmed, a stale target would keep the indicator off the picture
      // now that the two are joined again.
      return { ...state, liveLocked: action.locked, seekTarget: null }

    case 'SELECTION_BEGIN':
      // Only off the live edge, and this is the machine's half of the record
      // button's two effects (`record-control.ts`): at the live edge that press
      // starts a live CAPTURE — recording the picture forward from now — and
      // there is nothing here to anchor either, `playhead` being null while
      // live. The two flows share a control and a shape, never a state.
      if (state.mode === 'live') return state
      // A new selection starts as a ZERO-length span at the anchor. The free
      // end is the preview (`seekTarget`), and a previous selection's preview
      // outlives its Discard (the player is deliberately left where it was), so
      // without this a re-armed selection opened already stretched to the old
      // free end — "Delete 2m40s" before a single jog.
      return { ...state, selectionAnchor: action.epoch, seekTarget: null }

    case 'SELECTION_END':
      // Save and Discard both land here. The playhead is deliberately NOT
      // moved: the player is holding the last scrub frame, and snapping it back
      // to the anchor would restart a stream to show something the operator has
      // already finished with.
      return { ...state, selectionAnchor: null }

    default:
      return state
  }
}

// ── Throttle decision (ported from scrub-controller) ─────────────────────────

/**
 * Throttle continuous `scrubTo` emits to ~40 ms (25 targets/s).
 *
 * The same predicate the two scrub SURFACES use, at the player's own interval —
 * see `lib/scrub-throttle.ts`, which holds the one rule and the three numbers,
 * and `scrub-dispatch-budget.spec.ts`, which folds a real 60 Hz gesture through
 * each of them.
 */
export function shouldEmit(
  lastEmitMs: number,
  now: number,
  throttleMs = PLAYER_SCRUB_EMIT_MS,
): boolean {
  return shouldEmitScrubSample(lastEmitMs, now, throttleMs)
}

// ── Commit dedupe (ported from scrub-controller) ─────────────────────────────

export interface LastCommit {
  readonly epoch: number
  readonly at: number
}

/** Epochs within this many ms of the last commit count as the SAME target. */
export const COMMIT_DEDUPE_TOLERANCE_MS = 750
/** Only dedupe against a commit made within this recent window. */
export const COMMIT_DEDUPE_WINDOW_MS = 2000

/**
 * Decide whether a seek/commit should actually hit the playback sink. Each commit
 * reloads the server feeder (loading→playing) and visibly stutters; firing the
 * same (or near-identical) target twice in quick succession is a redundant
 * reload. Drop only when it targets essentially the SAME epoch AND that commit
 * was recent — a genuinely different target, or a re-seek after the window,
 * always commits.
 */
export function shouldCommit(
  last: LastCommit | null,
  epoch: number,
  now: number,
  toleranceMs = COMMIT_DEDUPE_TOLERANCE_MS,
  windowMs = COMMIT_DEDUPE_WINDOW_MS,
): boolean {
  if (last === null) return true
  const sameTarget = Math.abs(epoch - last.epoch) <= toleranceMs
  const recent = now - last.at <= windowMs
  return !(sameTarget && recent)
}

// ── Selectors ────────────────────────────────────────────────────────────────

/**
 * The epoch to render the cursor/indicator at: the seek preview while seeking,
 * else the playhead (null ⟺ live → callers fall back to wall-clock now).
 *
 * While the LIVE LOCK is armed the preview outlives the drag, and it is the
 * position the operator is browsing — the picture stays where it is, so the
 * timeline is the only thing left that can say where they are looking.
 */
export function selectActiveEpoch(state: PlaybackState): number | null {
  if (state.mode === 'seeking') return state.seekTarget
  if (state.liveLocked && state.seekTarget !== null) return state.seekTarget
  // Same clause, same reason, for a selection: the preview outlives the drag,
  // and it is the selection's free end — what the band is drawn to.
  if (state.selectionAnchor !== null && state.seekTarget !== null) return state.seekTarget
  return state.playhead
}

/** The export selection's fixed end, or null when none is armed. Read through a
 *  selector so a caller never reaches into the field to decide "is it armed". */
export function selectExportSelectionAnchor(state: PlaybackState): number | null {
  return state.selectionAnchor
}

/**
 * The direction to draw on the play/pause button, or null to leave it alone.
 *
 * Gated on the MODE and not merely on the field: a direction that survived a
 * commit would replace play/pause with an arrow that never comes back, and the
 * operator would have no way to pause. The reducer clears it too — belt and
 * braces, because this is the one control they need.
 */
export function selectScrubDirection(state: PlaybackState): ScrubDirection | null {
  return state.mode === 'seeking' ? state.scrubDirection : null
}

/** The status chip (LIVE vs playhead clock) as a pure selector over the machine
 *  state. Maps the machine mode onto the embed-mode `derivePlaybackStatus` reads
 *  (which stays untouched): seeking/playback → clock, gap/error/live passthrough. */
export function selectPlaybackStatus(state: PlaybackState): PlaybackStatus {
  const embedMode: EmbedPlaybackMode =
    state.mode === 'live'
      ? 'live'
      : state.mode === 'gap'
        ? 'gap'
        : state.mode === 'error'
          ? 'error'
          : 'playing'
  return derivePlaybackStatus({ mode: embedMode, playheadEpoch: selectActiveEpoch(state) })
}

// ── Playback control sink ─────────────────────────────────────────────────────

/**
 * The always-active imperative playback surface the machine drives (the WebRTC
 * embed handle). `goLive` remounts / returns the player to the live edge.
 */
/**
 * The px→time mapping decision that produced a drag target (`drag-mapping.ts`):
 * `fine` jog dial vs `coarse` absolute zoom, and the finger velocity that
 * decided it. Instrumentation — the server pushes the same frames without it,
 * but it is the only way the mapping phase reaches the hub's per-drag census.
 */
export interface ScrubMapHint {
  readonly mode: 'fine' | 'coarse'
  readonly velocityPxPerS: number
}

export interface PlaybackControlSink {
  /** `dragId` names the gesture this call belongs to — see `scrub-drag-id.ts`.
   *  Undefined when the caller has none (defensive only; the bridge always
   *  mints one before driving this). */
  scrubStart(dragId?: string): void
  scrubTo(epochMs: number, hint?: ScrubMapHint): void
  /** `dragId` is the SAME id `scrubStart` got for this gesture — undefined for
   *  a commit with no preceding drag (e.g. a stray call outside a scrub). */
  scrubCommit(epochMs: number, dragId?: string): void
  seek(epochMs: number): void
  goLive(): void
}

// ── Pure bridge factory ───────────────────────────────────────────────────────

/** A mutable holder, structurally compatible with React's `MutableRefObject`. */
export interface MutableRef<T> {
  current: T
}

/** The gesture callbacks the hook exposes (everything except `state`). */
type PlaybackBridge = Omit<PlaybackMachine, 'state'>

/**
 * Builds the bridge callbacks from a sink, a dispatch, and the throttle/commit
 * refs. Pure (no React) so it can be unit-tested directly: the hook just wraps
 * each callback in a memo.
 */
export function makePlaybackBridge(
  sink: PlaybackControlSink,
  dispatch: (action: PlaybackAction) => void,
  lastEmitRef: MutableRef<number>,
  lastCommitRef: MutableRef<LastCommit | null> = { current: null },
  /** Reports whether the PLAYER is currently on the live edge. A live→recorded
   *  commit bypasses dedupe so the seek always reaches the server (there is no
   *  feeder to redundantly reload yet — dedupe could only strand the player). */
  isPlayerLive: () => boolean = () => false,
  /** Reports whether the LIVE LOCK is armed. A getter, not a value: the bridge
   *  is memoized on the sink and must read the CURRENT flag, not the one that
   *  held when it was built. */
  isLiveLocked: () => boolean = () => false,
  /** Reports whether the PICTURE is already on the live edge (`mode === 'live'`).
   *  Snap-home while locked must not remount a stream that never left live. */
  isPictureLive: () => boolean = () => false,
  /** The current gesture's id (`scrub-drag-id.ts`) — minted in `beginScrub`,
   *  consumed and cleared in `commitScrub`, so a `commitScrub` with no
   *  preceding `beginScrub` (or one that already fired) carries none. */
  dragIdRef: MutableRef<string | null> = { current: null },
  /** Reports whether an EXPORT SELECTION is armed. A getter for the same reason
   *  `isLiveLocked` is one: the bridge is memoized on the sink. */
  isSelecting: () => boolean = () => false,
): PlaybackBridge {
  const commit = (epoch: number, fire: (epoch: number) => void, kind: string): void => {
    const now = Date.now()
    if (isPlayerLive()) {
      lastCommitRef.current = { epoch, at: now }
      fire(epoch)
      return
    }
    if (!shouldCommit(lastCommitRef.current, epoch, now)) {
      log.debug('playback:machine', 'commit deduped', { epoch, kind, last: lastCommitRef.current })
      return
    }
    lastCommitRef.current = { epoch, at: now }
    fire(epoch)
  }
  // Every navigation gesture DISPATCHES unconditionally — the timeline must
  // still move under the finger — and only the SINK is withheld while the live
  // lock is armed. That split is the whole feature: browse the recording
  // without taking the picture off the live edge.
  return {
    beginScrub: (source: ScrubSource): void => {
      dispatch({ type: 'SCRUB_BEGIN', source })
      if (isLiveLocked()) return
      // Mint the gesture's id HERE, once, for the whole drag through to its
      // commit (see `scrub-drag-id.ts`) — a live-locked drag never drives the
      // sink at all, so it gets none.
      const dragId = generateDragId()
      dragIdRef.current = dragId
      // Start the client-side first-frame clock HERE and not on the dispatch:
      // a live-locked drag moves the timeline without driving the server, so
      // it has no frame to wait for and must not report one.
      scrubDragStarted()
      sink.scrubStart(dragId)
    },
    moveScrub: (epoch: number, source: ScrubSource, hint?: ScrubMapHint): void => {
      dispatch({ type: 'SCRUB_MOVE', epoch, source })
      if (isLiveLocked()) return
      const now = Date.now()
      if (!shouldEmit(lastEmitRef.current, now)) return
      lastEmitRef.current = now
      // Two-arg only when a hint EXISTS — callers and tests treat the bare
      // emit and the hinted emit as distinct call shapes.
      if (hint) sink.scrubTo(epoch, hint)
      else sink.scrubTo(epoch)
    },
    commitScrub: (epoch: number, source: ScrubSource): void => {
      dispatch({ type: 'SCRUB_COMMIT', epoch, source })
      // An armed selection never LANDS. The server holds the last pushed scrub
      // keyframe on the track until a commit's burst replaces it, so skipping
      // the commit leaves exactly the frame the finger stopped on — which is
      // what the operator asked for ("no playback during the selection, just
      // the last frame reached"). The dragId is still consumed so it cannot
      // resurface on a later unrelated commit.
      if (isSelecting()) {
        dragIdRef.current = null
        return
      }
      if (isLiveLocked() && source !== 'cluster') return
      // The SAME id `beginScrub` minted for this gesture, consumed once: a
      // later commitScrub with no drag behind it (e.g. a bare tap routed
      // through here) gets none, not a stale one from a previous drag.
      const dragId = dragIdRef.current ?? undefined
      dragIdRef.current = null
      // `info`, not `debug`: this is the ONE app-side line naming a scrub
      // commit's dragId (`scrub-drag-id.ts`) — a debug-only line never leaves
      // a phone that doesn't have debug mode on, and the whole point of C1 is
      // joining THIS line to the hub's `scrub-feeder:*`/`recorded:seek-*`
      // lines after the fact, from a report that arrived with debug mode off.
      // See `ALWAYS_SHIP_SCOPES` in `lib/logger.ts` — one line per gesture, so
      // it stays low-rate and bounded like the rest of that allowlist.
      log.info('playback:machine', 'commitScrub', { epoch, source, dragId })
      // Two-arg only when a dragId EXISTS — mirrors `moveScrub`'s hint: callers
      // and tests treat the bare commit and the drag-tagged commit as distinct
      // call shapes.
      commit(epoch, (e) => (dragId !== undefined ? sink.scrubCommit(e, dragId) : sink.scrubCommit(e)), 'scrubCommit')
    },
    seek: (epoch: number, source: ScrubSource): void => {
      dispatch({ type: 'SEEK', epoch, source })
      if (isSelecting()) {
        // A tap (heatmap, cluster card) while selecting is "put the free end
        // here". A real `seek` would land and start playing, so it is served as
        // a degenerate one-position drag instead: the server pushes the frame
        // at that instant and holds it, exactly as a drag's last retarget does.
        // No commit follows, so nothing lands.
        sink.scrubStart()
        sink.scrubTo(epoch)
        return
      }
      if (isLiveLocked() && source !== 'cluster') return
      log.debug('playback:machine', 'seek', { epoch, source })
      commit(epoch, sink.seek, 'seek')
    },
    adoptSeek: (epoch: number, source: ScrubSource): void => {
      // A seek the EMBED already performed on its own (the config-carried
      // `initialSeekMs`): move the machine into playback with the anchor armed,
      // WITHOUT driving the sink — re-seeking would reload a feeder that is
      // already playing the target. Recorded in the dedupe memory so an
      // immediate re-seek to the same instant stays a no-op.
      dispatch({ type: 'SEEK', epoch, source })
      lastCommitRef.current = { epoch, at: Date.now() }
      log.debug('playback:machine', 'adoptSeek', { epoch, source })
    },
    swapCamera: (atMs: number | null): void => {
      dispatch({ type: 'SWAP_CAMERA', atMs })
      // The dedupe memory belongs to the OLD camera: a `lastCommit` left behind
      // would swallow the first seek to the same instant on the NEW one. Same
      // reason `goLive` clears it.
      lastCommitRef.current = null
      dragIdRef.current = null
      log.info('playback:machine', 'swap camera', { atMs })
    },
    setLiveLock: (locked: boolean): void => dispatch({ type: 'SET_LIVE_LOCK', locked }),
    beginSelection: (epoch: number): void => dispatch({ type: 'SELECTION_BEGIN', epoch }),
    endSelection: (): void => dispatch({ type: 'SELECTION_END' }),
    toggleLiveLock: (): void => dispatch({ type: 'SET_LIVE_LOCK', locked: !isLiveLocked() }),
    goLive: (): void => {
      dispatch({ type: 'GO_LIVE' })
      // Clear the commit memory so the NEXT live→recorded seek always fires: a
      // stale `lastCommit` from a prior recorded session (not cleared by leaving
      // recorded) would otherwise dedupe a re-seek to the same spot and strand
      // the player on the live edge.
      lastCommitRef.current = null
      // Same hygiene for the drag id: an abandoned gesture (begun, never
      // committed) must not have its id resurface on some later unrelated
      // commit.
      dragIdRef.current = null
      // Live-lock while already live: the timeline snaps home (GO_LIVE above
      // drops the preview) but the picture never left the live edge. Driving
      // the sink remounts the WebRTC session — the "scrolled back to today
      // and the stream restarted" report. The way back from a recorded
      // playhead (lock armed mid-playback) still remounts, because then
      // `isPictureLive` is false.
      if (isLiveLocked() && isPictureLive()) return
      sink.goLive()
    },
    reportPosition: (epoch: number): void => dispatch({ type: 'POSITION_REPORT', epoch }),
    reportEmbedState: (embed: EmbedPlaybackMode): void => dispatch({ type: 'EMBED_STATE', embed }),
  }
}

// ── usePlaybackMachine hook ───────────────────────────────────────────────────

export interface PlaybackMachine {
  readonly state: PlaybackState
  readonly beginScrub: (source: ScrubSource) => void
  readonly moveScrub: (epoch: number, source: ScrubSource, hint?: ScrubMapHint) => void
  readonly commitScrub: (epoch: number, source: ScrubSource) => void
  readonly seek: (epoch: number, source: ScrubSource) => void
  /** Adopt a seek the embed already performed (config-carried `initialSeekMs`):
   *  machine state only, the sink is deliberately NOT driven. */
  readonly adoptSeek: (epoch: number, source: ScrubSource) => void
  /** Arm/disarm the live lock explicitly. */
  readonly setLiveLock: (locked: boolean) => void
  /** Flip it — what the bar's leading control is wired to. */
  readonly toggleLiveLock: () => void
  /** Arm the export selection at the epoch the player is currently showing.
   *  A no-op at the live edge (see `SELECTION_BEGIN`). */
  readonly beginSelection: (epoch: number) => void
  /** Drop it. Both Save and Discard call this; Save creates the export first. */
  readonly endSelection: () => void
  readonly goLive: () => void
  /** Reset for a camera swapped in place, seeded at `atMs` (null ⟺ live). */
  readonly swapCamera: (atMs: number | null) => void
  readonly reportPosition: (epoch: number) => void
  readonly reportEmbedState: (embed: EmbedPlaybackMode) => void
}

/**
 * Owns the single playhead/mode state for one camera instance and bridges it to
 * a playback control sink.
 *
 * @param sink Always-active playback control surface (the WebRTC embed handle).
 * @param isPlayerLive Optional getter for "is the player on the live edge?"; a
 *   live→recorded commit bypasses dedupe so the seek always reaches the server.
 *   The consumer does not need to wire this today — `goLive()` already clears the
 *   commit memory, so the first seek out of live always fires.
 */
export function usePlaybackMachine(
  sink: PlaybackControlSink,
  isPlayerLive: () => boolean = () => false,
): PlaybackMachine {
  const [state, dispatch] = useReducer(playbackReducer, initialPlaybackState)
  const lastEmitRef = useRef(0)
  const lastCommitRef = useRef<LastCommit | null>(null)
  const dragIdRef = useRef<string | null>(null)
  // Keep the latest getter in a ref so the bridge (memoized on `sink`) always
  // reads the current live state without being re-created each render.
  const isPlayerLiveRef = useRef(isPlayerLive)
  isPlayerLiveRef.current = isPlayerLive
  // Same reason, for the lock: the bridge is memoized on `sink`, so it has to
  // read the flag through a ref rather than close over the render it was built in.
  const liveLockedRef = useRef(state.liveLocked)
  liveLockedRef.current = state.liveLocked
  const pictureLiveRef = useRef(state.mode === 'live')
  pictureLiveRef.current = state.mode === 'live'
  // Same ref discipline as the lock: the bridge is memoized on `sink`.
  const selectingRef = useRef(state.selectionAnchor !== null)
  selectingRef.current = state.selectionAnchor !== null

  const bridge = useMemo(
    () =>
      makePlaybackBridge(
        sink,
        dispatch,
        lastEmitRef,
        lastCommitRef,
        () => isPlayerLiveRef.current(),
        () => liveLockedRef.current,
        () => pictureLiveRef.current,
        dragIdRef,
        () => selectingRef.current,
      ),
    [sink],
  )

  return { state, ...bridge }
}
