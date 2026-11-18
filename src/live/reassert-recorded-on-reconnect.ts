/**
 * Re-enter recorded playback after a host-driven WebRTC reconnect.
 *
 * Foregrounding injects `reconnect()` and rebuilds the peer; the embed SPA
 * survives, but the broker's per-viewer recorded pointer is gone and the
 * picture falls back to live while the host machine still says playback.
 */
import { resolvePlaybackEntryProfile, type EmbedPlaybackTarget } from '../../embed/src/playback/playback-profile.js'
import type { PlaybackMode as MachinePlaybackMode } from '../recording/playback-machine.js'
import type { WebrtcTarget } from './signaling-types.js'

export interface ReassertRecordedOnReconnectInput {
  /** The playback machine's mode — not the embed's recState. */
  readonly playbackMode: MachinePlaybackMode
  /** Epoch to restore; null means live edge (nothing to reassert). */
  readonly playheadEpoch: number | null
  /** When set, clip reassert owns reconnect — not playRecorded. */
  readonly clipHoldingFrame: string | null
}

export function shouldReassertRecordedOnReconnect(input: ReassertRecordedOnReconnectInput): boolean {
  if (input.clipHoldingFrame !== null) return false
  if (input.playbackMode === 'live') return false
  return input.playheadEpoch !== null
}

function targetToEmbedPlaybackTarget(target: WebrtcTarget): EmbedPlaybackTarget {
  if (target.kind === 'profile' && target.profile !== undefined) {
    return { kind: 'profile', profile: target.profile }
  }
  return { kind: 'adaptive' }
}

/** A clip holding the frame, on its own FILE-relative axis. */
export interface PlayRecoveryClip {
  /** The clip's last reported position, or `null` before the first report. */
  readonly offsetMs: number | null
}

/** What the play button's recovery reads. */
export interface PlayRecoveryInput {
  readonly mode: MachinePlaybackMode
  readonly playhead: number | null
  /** The clip holding the frame, or `null` when none does. */
  readonly clip: PlayRecoveryClip | null
  /**
   * The embed's last recorded state was `error`. Under a clip the machine does
   * not adopt it (D570 — a clip leaves the machine where it was), so this is
   * the only place a clip's failure is visible to the play button.
   */
  readonly embedFailed: boolean
}

/** Where a play press re-enters playback. */
export type PlayRecovery =
  /** Play is just "resume": a rate change. */
  | { readonly kind: 'none' }
  /** Re-enter the recording at this absolute instant. */
  | { readonly kind: 'epoch'; readonly epochMs: number }
  /** Re-open the held clip at this FILE-relative offset. */
  | { readonly kind: 'clip'; readonly offsetMs: number }

/**
 * Where a play press re-enters playback after an ERROR — the hub holds no
 * pointer for this viewer any more, so a rate change would move nothing.
 *
 * A clip holding the frame recovers on ITS axis: re-open the file at its last
 * position. Never an absolute instant — sent while a clip holds the pointer,
 * that epoch would be read as a file offset hours past the end.
 *
 * Without a clip: the playhead, which survives the error (the machine stops
 * adopting positions there), so it is the cursor the operator was on.
 */
export function resolvePlayRecovery(input: PlayRecoveryInput): PlayRecovery {
  const failed = input.mode === 'error' || input.embedFailed
  if (input.clip !== null) {
    if (!failed) return { kind: 'none' }
    return { kind: 'clip', offsetMs: input.clip.offsetMs ?? 0 }
  }
  if (input.mode !== 'error' || input.playhead === null) return { kind: 'none' }
  return { kind: 'epoch', epochMs: input.playhead }
}

/** Profile for `playRecorded` after reconnect — honours the tier that was serving. */
export function resolveRecordedProfileForReconnect(
  liveTarget: WebrtcTarget,
  servedProfile: string | null,
): string {
  if (servedProfile !== null && servedProfile.length > 0) return servedProfile
  return resolvePlaybackEntryProfile(targetToEmbedPlaybackTarget(liveTarget), 'low')
}
