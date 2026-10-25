/**
 * PiP of a camera must show LIVE. The PiP disc and the swipe-back handoff both
 * act on the same <LiveView> that also plays recorded footage, so a request
 * made while scrubbing would otherwise picture-in-picture the playhead.
 */
import type { PlaybackMode } from '../../recording/playback-machine.js'
import type { PlayerConnectionState } from '../../live/live-view-types.js'

/** True when PiP must first return the player to the live edge. */
export function shouldGoLiveBeforePip(mode: PlaybackMode): boolean {
  return mode !== 'live'
}

/**
 * After goLive remounts the WebView, starting PiP is only safe once the NEW
 * session is playing. Injecting PiP into the dying recorded session — or into
 * a connecting live session that has no frame yet — is the defect.
 */
export function pipReadyAfterGoLive(args: {
  readonly pending: boolean
  readonly mode: PlaybackMode
  readonly playerState: PlayerConnectionState
}): boolean {
  return args.pending && args.mode === 'live' && args.playerState === 'playing'
}

/**
 * The other end of that wait. A player that reports `error` will not produce
 * the live session PiP is waiting for, so the request is answered instead of
 * left pending forever — a pending request the caller cannot see is a swipe
 * that silently stops working for the rest of the session.
 */
export function goLiveFailedBeforePip(playerState: PlayerConnectionState): boolean {
  return playerState === 'error'
}
