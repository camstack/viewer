import { describe, it, expect } from 'vitest'
import { thumbMediaAddress } from '../thumb-address.js'
import type { ObjectEvent } from '../event-cluster.js'

const track: ObjectEvent = {
  id: 'ev-1',
  deviceId: 101,
  className: 'person',
  timestamp: 1_000,
  trackId: 'tr-1',
}

describe('thumbMediaAddress — what a timeline thumb fetches', () => {
  it('a track is addressed by its OWNER (D482), never by its event id', () => {
    expect(thumbMediaAddress(track, false)).toEqual({
      kind: 'owner',
      ownerType: 'track',
      ownerId: 'tr-1',
    })
  })

  it('an explicit snapshot URL wins over every address', () => {
    expect(thumbMediaAddress(track, true)).toBeNull()
  })

  it('an item with no track falls to the glyph rather than guessing an owner', () => {
    expect(
      thumbMediaAddress({ id: 'x', deviceId: 101, className: 'motion', timestamp: 1 }, false),
    ).toBeNull()
  })
})
