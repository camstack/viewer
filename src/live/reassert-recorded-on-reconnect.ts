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

/** The two machine facts the play button's recovery reads. */
export interface PlayRecoveryInput {
  readonly mode: MachinePlaybackMode
  readonly playhead: number | null
}

/**
 * Where a play press re-enters playback, or null when play is just "resume".
 *
 * Only after an ERROR: the hub holds no recorded pointer for this viewer any
 * more, so a rate change would move nothing. The playhead survives the error
 * (the machine stops adopting positions there), so it is the cursor the
 * operator was on.
 */
export function resolvePlayRecovery(input: PlayRecoveryInput): number | null {
  if (input.mode !== 'error') return null
  return input.playhead
}

/** Profile for `playRecorded` after reconnect — honours the tier that was serving. */
export function resolveRecordedProfileForReconnect(
  liveTarget: WebrtcTarget,
  servedProfile: string | null,
): string {
  if (servedProfile !== null && servedProfile.length > 0) return servedProfile
  return resolvePlaybackEntryProfile(targetToEmbedPlaybackTarget(liveTarget), 'low')
}
