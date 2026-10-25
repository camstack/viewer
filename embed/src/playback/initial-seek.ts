/**
 * Config-carried initial seek — the deep-link "go to this moment" without a
 * host round-trip.
 *
 * `initialSeekMs` rides the injected embed config, so the page can enter
 * recorded playback the moment its control channel opens instead of waiting
 * for the RN bridge to observe a state report and post a seek back. One burst,
 * two pointer messages: `warm` (pre-run locate + GOP fetch + demux for the
 * instant the timeline will open on, at the scrub profile — a pure server-side
 * cache fill) and `playRecorded` (the actual pointer move into recorded, at
 * the playback profile).
 *
 * Returns whether the seek was actually SENT. A `false` (no session yet, or a
 * channel that is not open) leaves the pending seek with the caller — firing
 * is consumption, arrival is not.
 */

/** The slice of `RecordedTrackSession` this helper drives. */
export interface InitialSeekSessionLike {
  isOpen(): boolean
  warm(epochMs: number): boolean
  playRecorded(deviceId: number, epochMs: number, profile: string): boolean
}

export function fireInitialSeek(
  session: InitialSeekSessionLike | null,
  deviceId: number,
  epochMs: number,
  profile: string,
): boolean {
  if (!session?.isOpen()) return false
  session.warm(epochMs)
  return session.playRecorded(deviceId, epochMs, profile)
}
