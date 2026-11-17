/**
 * clip-offer-intent — mark the FIRST WebRTC offer of a page opened on a clip.
 *
 * With `intent: 'clip'` the hub serves a CamStack-recorded clip without
 * demanding live from the camera, so a sleeping battery camera's clips play.
 * The server then asks for a re-offer when the viewer goes live, and that
 * re-offer must be a plain live offer: the intent rides the first offer only,
 * never the re-offer and never a live-opened page.
 *
 * "Opened on a clip" means the page opens in RECORDED playback: a config clip
 * OR a config-carried seek. The app opens a clip on the camera page as a seek
 * with no clip id; without the intent that offer dialled a sleeping camera
 * live and the session was torn down until it woke (planning#566).
 */
import type { ClientStreamHints } from '@camstack/ui-library'

/** The offer hints plus the intent the published `ClientStreamHints` lacks. */
export type OfferHints = ClientStreamHints & { readonly intent?: 'live' | 'clip' }

export interface ClipOfferIntent {
  /** Hints for an initial offer; the clip intent is added once, then never. */
  readonly forOffer: (hints: ClientStreamHints | undefined) => OfferHints | undefined
}

/** The config fields that decide the page's initial recorded playback. */
export interface RecordedOpenConfig {
  readonly initialClipId?: string
  readonly initialSeekMs?: number
}

/** Whether the page opens in recorded playback (a config clip or seek). */
export function opensInRecorded(config: RecordedOpenConfig): boolean {
  return config.initialClipId !== undefined || config.initialSeekMs !== undefined
}

export function createClipOfferIntent(openedOnClip: boolean): ClipOfferIntent {
  let pending = openedOnClip
  return {
    forOffer: (hints) => {
      if (!pending) return hints
      pending = false
      return { ...hints, intent: 'clip' }
    },
  }
}
