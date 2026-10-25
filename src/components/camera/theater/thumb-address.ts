/**
 * What a timeline thumb fetches — the address decision, alone and pure.
 *
 * A track resolves through the owner ladder (`/event-media/o/track/<trackId>`),
 * because its best media is a question the plane answers about the track.
 *
 * The address is never GUESSED from the shape of a string: an item with no
 * snapshot and no track has nothing to fetch and says so, so the card draws
 * its class glyph instead of 404-ing against an invented owner.
 */
import type { MediaAddress } from '../../../data/use-event-media.js'
import type { ObjectEvent } from './event-cluster.js'

/**
 * The address for `event`'s thumbnail, or null when there is nothing to fetch.
 *
 * @param hasSnapshot - the caller already has an explicit `mediaUrl` to render;
 *   the address is then deliberately null (see `EventThumb`'s fast path).
 */
export function thumbMediaAddress(event: ObjectEvent, hasSnapshot: boolean): MediaAddress | null {
  if (hasSnapshot) return null
  if (typeof event.trackId === 'string' && event.trackId.length > 0) {
    return { kind: 'owner', ownerType: 'track', ownerId: event.trackId }
  }
  return null
}
