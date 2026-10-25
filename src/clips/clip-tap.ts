/**
 * clip-tap — what tapping a clip card DOES.
 *
 * Two clips on this timeline, two players, and nothing in between:
 *
 * - A clip of OUR recording is a time WINDOW. The embed player's recorded
 *   transport reaches it by epoch (`seek(epochMs)`), and it is already the
 *   surface's hero — no file, no URL, no second component.
 * - A clip the CAMERA wrote is a FILE. The recorded transport cannot reach it
 *   at all: seeking its epoch lands on whatever our recorder happened to hold
 *   at that instant, or on nothing. It plays in the app's file player, the same
 *   one an export opens in.
 *
 * That is why this is a decision and not a branch inside the handler: the two
 * paths are different players, and the one thing that must never happen is a
 * sequencer advancing from one into the other. `resolveClipAdvance` seeks; a
 * native clip has nothing to seek.
 *
 * Pure: no React, no i18n, no network.
 */

import { cheapestClipProfile, type ClipProfile } from './clip-quality.js'
import { isPlayable, type Clip } from './clip-model.js'

/** What the surface should do with a tapped clip. */
export type ClipTap =
  /** Seek OUR footage to this instant. The hero plays it in place. */
  | { readonly kind: 'seek'; readonly epochMs: number }
  /** Ask `videoclips.getClipPlayback` for this clip, then play the file. */
  | { readonly kind: 'file'; readonly deviceId: number; readonly clipId: string; readonly profile: ClipProfile | null }
  /** The provider said this clip cannot be served, and why (or null: it did
   *  not say, and a reason must never be invented). */
  | { readonly kind: 'refused'; readonly reason: string | null }

/**
 * The decision, read entirely off the row.
 *
 * `playable: false` is checked FIRST and through {@link isPlayable}, so the one
 * rule about what the provider refused lives in one place. The refusal carries
 * its reason to the surface rather than becoming a tap that does nothing —
 * a card that swallows a press is indistinguishable from an app that hung.
 */
export function resolveClipTap(clip: Clip): ClipTap {
  if (!isPlayable(clip)) {
    return { kind: 'refused', reason: clip.unplayableReason ?? null }
  }
  switch (clip.playback.kind) {
    case 'recorded':
      return { kind: 'seek', epochMs: clip.startMs }
    case 'native':
      return {
        kind: 'file',
        deviceId: clip.playback.deviceId,
        clipId: clip.playback.clipId,
        // Never `high` unless `high` is the only copy, and never `auto`:
        // a stored file has no broker session to resolve an adaptive tier from.
        profile: cheapestClipProfile(clip),
      }
  }
}
