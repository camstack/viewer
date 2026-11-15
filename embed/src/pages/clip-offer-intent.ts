/**
 * clip-offer-intent — mark the FIRST WebRTC offer of a page opened on a clip.
 *
 * With `intent: 'clip'` the hub serves a CamStack-recorded clip without
 * demanding live from the camera, so a sleeping battery camera's clips play.
 * The server then asks for a re-offer when the viewer goes live, and that
 * re-offer must be a plain live offer: the intent rides the first offer only,
 * never the re-offer and never a live-opened page.
 */
import type { ClientStreamHints } from '@camstack/ui-library'

/** The offer hints plus the intent the published `ClientStreamHints` lacks. */
export type OfferHints = ClientStreamHints & { readonly intent?: 'live' | 'clip' }

export interface ClipOfferIntent {
  /** Hints for an initial offer; the clip intent is added once, then never. */
  readonly forOffer: (hints: ClientStreamHints | undefined) => OfferHints | undefined
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
