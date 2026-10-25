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

/** Profile for `playRecorded` after reconnect — honours the tier that was serving. */
export function resolveRecordedProfileForReconnect(
  liveTarget: WebrtcTarget,
  servedProfile: string | null,
): string {
  if (servedProfile !== null && servedProfile.length > 0) return servedProfile
  return resolvePlaybackEntryProfile(targetToEmbedPlaybackTarget(liveTarget), 'low')
}
