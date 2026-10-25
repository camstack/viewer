/**
 * playback-status — pure derivation of the recorded-playback status chip
 * (LIVE vs playhead clock) plus a ±10s jog target helper.
 *
 * No React deps; unit-tested in isolation.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * What the EMBED says the picture is doing.
 *
 * `ended` is the feeder's "this played out" — a clip whose file finished
 * (`clip-stream-feeder.ts`) or our own footage running past its last segment.
 * It reached the app as `error` until 2026-09-23, because both host seams
 * dropped it onto their `default:` arm; `live/rec-state.ts` is now the one
 * mapper and it carries the state through. It is NOT a failure and nothing
 * here may treat it as one.
 */
export type PlaybackMode = 'live' | 'loading' | 'playing' | 'paused' | 'gap' | 'ended' | 'error'

export interface PlaybackStatusInput {
  readonly mode: PlaybackMode
  readonly playheadEpoch: number | null
}

export interface PlaybackStatus {
  readonly isLive: boolean
  readonly label: string
  readonly showGoLive: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clock(epochMs: number): string {
  const d = new Date(epochMs)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// ── Derivation ───────────────────────────────────────────────────────────────

export function derivePlaybackStatus(input: PlaybackStatusInput): PlaybackStatus {
  if (input.mode === 'live') return { isLive: true, label: 'LIVE', showGoLive: false }
  if (input.mode === 'gap') return { isLive: false, label: 'No footage', showGoLive: true }
  if (input.mode === 'error') return { isLive: false, label: 'Error', showGoLive: true }
  if (input.playheadEpoch == null) return { isLive: false, label: '…', showGoLive: true }
  return { isLive: false, label: clock(input.playheadEpoch), showGoLive: true }
}

// ── Initial seek (deep-link go-to-moment) ────────────────────────────────────

/** What the host must do with a still-pending `?at=` initial seek, given the
 *  FIRST recorded-state report the embed sends. */
export type InitialSeekAction = 'adopt' | 'seek'

/**
 * Decide the pending initial seek's fate from the embed's first report.
 *
 * A NEW embed honours the config-carried `initialSeekMs` on its own: its first
 * report is already a recorded-flow state (`loading`/`playing`/`paused`/`gap`),
 * so the host must NOT re-seek — a second playRecorded reloads a feeder that is
 * already playing the target. It only ADOPTS the seek into the playback machine
 * (timeline/chip leave LIVE). An OLD embed (deployed before the config field)
 * ignores the field and can only first report `live` or `error` — the host then
 * falls back to the RN-bridge seek exactly as before.
 */
export function resolveInitialSeekAction(embed: PlaybackMode): InitialSeekAction {
  return embed === 'live' || embed === 'error' ? 'seek' : 'adopt'
}

// ── Jog ──────────────────────────────────────────────────────────────────────

export const JOG_MS = 10_000

/**
 * Resolve the epoch a ±10s jog should measure from. The playhead is the primary
 * source, but it can briefly be `null` (e.g. during a settling seek before the
 * position reconciles). In that window fall back to the caller-supplied active
 * epoch (the timeline indicator's seek-preview / cursor epoch) so the jog does
 * not silently no-op. Returns `null` only when BOTH are null (truly no anchor).
 */
export function resolveJogBase(
  playheadEpoch: number | null,
  fallbackEpoch: number | null,
): number | null {
  return playheadEpoch ?? fallbackEpoch
}

/**
 * Where a jog measures from. Normally the playhead; while a selection is armed
 * it is the selection's FREE END (the active epoch), because the machine holds
 * the player still and the indicator, not the playhead, is what moves.
 */
export function jogBaseFor(
  selecting: boolean,
  playheadEpoch: number | null,
  activeEpoch: number | null,
): number | null {
  return selecting ? (activeEpoch ?? playheadEpoch) : resolveJogBase(playheadEpoch, activeEpoch)
}

export function jogTarget(playheadEpoch: number | null, dir: 1 | -1): number | null {
  if (playheadEpoch == null) return null
  return playheadEpoch + dir * JOG_MS
}

/**
 * Where an event tap / "go to this moment" must land: the event timestamp
 * itself, never past the recording floor.
 *
 * The operator asked for the moment, not a jog-sized lead-in. ±{@link JOG_MS}
 * stays on the transport buttons only. `floorMs` is the recording start when
 * the caller knows it; otherwise 0.
 */
export function eventMomentSeekMs(eventEpochMs: number, floorMs: number = 0): number {
  const floor = Number.isFinite(floorMs) && floorMs > 0 ? floorMs : 0
  return Math.max(floor, Math.round(eventEpochMs))
}
