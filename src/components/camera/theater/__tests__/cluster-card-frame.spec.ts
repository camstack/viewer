/**
 * The selected clip wears ONE frame (#443).
 *
 * In clips mode the card's own border and its single thumbnail's border both
 * turned to the accent on selection — two concentric squares. The thumbnail is
 * already the tilted pill (`ClusterPill`, -2deg at index 0), so it alone is the
 * frame; the card keeps its neutral border. The event gallery (paging) keeps
 * its two levels: the card says which group, the thumbnail which member.
 */
import { describe, expect, it } from 'vitest'

import { clusterCardFrame } from '../cluster-card-frame.js'

describe('clips mode: one tilted frame around the selected clip', () => {
  it('a selected clip lights the pill only', () => {
    expect(clusterCardFrame({ paging: false, selected: true, playing: false, active: true })).toEqual({
      card: false,
      pill: true,
    })
  })

  it('a playing clip lights the pill only', () => {
    expect(clusterCardFrame({ paging: false, selected: false, playing: true, active: true })).toEqual({
      card: false,
      pill: true,
    })
  })

  it('an idle clip lights nothing', () => {
    expect(clusterCardFrame({ paging: false, selected: false, playing: false, active: true })).toEqual({
      card: false,
      pill: false,
    })
  })
})

describe('the event gallery keeps its two levels', () => {
  it('card for the group, pill for the tapped member', () => {
    expect(clusterCardFrame({ paging: true, selected: true, playing: false, active: false })).toEqual({
      card: true,
      pill: false,
    })
    expect(clusterCardFrame({ paging: true, selected: false, playing: false, active: true })).toEqual({
      card: false,
      pill: true,
    })
  })
})
