/**
 * The location picker's rules.
 *
 * The operator, 2026-09-16: a selector between the reel and the list, showing
 * the existing locations, with Favourites first and a heart on each card.
 */
import { describe, expect, it } from 'vitest'

import {
  camerasInBucket,
  FAVOURITES_BUCKET,
  locationBucket,
  locationsOf,
  zoneBucket,
  type LocatableCamera,
  type ZoneView,
} from '../camera-locations.js'

const CAMS: readonly LocatableCamera[] = [
  { id: 1, location: 'Esterno' },
  { id: 2, location: 'Front door' },
  { id: 3, location: 'esterno' },
  { id: 4, location: null },
  { id: 5, location: '  ' },
]

describe('which locations the picker offers', () => {
  it('lists what the cameras actually have, sorted', () => {
    expect(locationsOf(CAMS)).toEqual(['Esterno', 'Front door'])
  })

  /**
   * "Esterno" and "esterno" are ONE place — the label is typed by hand on each
   * device, so two casings are a typo, not two rooms. The first spelling seen
   * wins, because inventing a canonical casing would rename the operator's own
   * label back at them.
   */
  it('folds casings into one bucket, keeping the first spelling', () => {
    expect(locationsOf(CAMS)).not.toContain('esterno')
  })

  /** A camera with no location is not a location called "nothing". */
  it('offers no bucket for unset or blank labels', () => {
    expect(locationsOf([{ id: 9, location: null }])).toEqual([])
    expect(locationsOf([{ id: 9, location: '   ' }])).toEqual([])
  })
})

describe('what a bucket selects', () => {
  it('null is everything — the picker resting state', () => {
    expect(camerasInBucket(CAMS, null, new Set()).length).toBe(CAMS.length)
  })

  it('a location takes both casings of itself', () => {
    expect(camerasInBucket(CAMS, locationBucket('Esterno'), new Set()).map((c) => c.id)).toEqual([1, 3])
  })

  it('and never the cameras with no location', () => {
    const ids = camerasInBucket(CAMS, locationBucket('Esterno'), new Set()).map((c) => c.id)
    expect(ids).not.toContain(4)
    expect(ids).not.toContain(5)
  })

  it('favourites takes the shortlist', () => {
    expect(camerasInBucket(CAMS, FAVOURITES_BUCKET, new Set([2, 4])).map((c) => c.id)).toEqual([
      2, 4,
    ])
  })

  /**
   * IN THE LIST'S ORDER, not the shortlist's. Starring a camera must not
   * reshuffle the page under the finger that starred it.
   */
  it('keeps the list order when showing favourites', () => {
    expect(camerasInBucket(CAMS, FAVOURITES_BUCKET, new Set([4, 1])).map((c) => c.id)).toEqual([
      1, 4,
    ])
  })

  /**
   * An EMPTY shortlist is a real answer: the bucket exists so the operator can
   * fill it, and showing every camera there would look like the starring had
   * not worked.
   */
  it('shows nothing when nothing is starred, rather than everything', () => {
    expect(camerasInBucket(CAMS, FAVOURITES_BUCKET, new Set())).toEqual([])
  })

  // The bucket must not collide with a label a person could type — and since
  // every other bucket is prefixed, a bare 'fav' cannot be produced by one.
  it('has a favourites key no location bucket can produce', () => {
    expect(locationBucket('fav')).not.toBe(FAVOURITES_BUCKET)
    expect(zoneBucket('fav')).not.toBe(FAVOURITES_BUCKET)
  })
})

describe('what a ZONE bucket selects', () => {
  // The operator, 2026-09-16: zones group locations and come BEFORE them in the
  // strip. A camera belongs to one location; a location to at most one zone.
  const ZONES: readonly ZoneView[] = [
    { zoneKey: 'night zone', label: 'Night zone', locationKeys: ['esterno'] },
    { zoneKey: 'vuota', label: 'Vuota', locationKeys: [] },
  ]

  it('takes every camera in every location of the zone', () => {
    const ids = camerasInBucket(CAMS, zoneBucket('night zone'), new Set(), ZONES).map((c) => c.id)
    // Both casings of "Esterno", because the zone holds the FOLDED key.
    expect(ids).toEqual([1, 3])
  })

  it('a zone with no locations selects nothing, not everything', () => {
    expect(camerasInBucket(CAMS, zoneBucket('vuota'), new Set(), ZONES)).toEqual([])
  })

  it('a zone the hub no longer reports selects nothing, not everything', () => {
    // Falling through to "all cameras" would be indistinguishable from the
    // filter having been cleared, and would hide that the zone is gone.
    expect(camerasInBucket(CAMS, zoneBucket('sparita'), new Set(), ZONES)).toEqual([])
  })

  it('a zone and a location of the SAME name are different buckets', () => {
    const zones: readonly ZoneView[] = [
      { zoneKey: 'esterno', label: 'Esterno', locationKeys: ['front door'] },
    ]
    expect(camerasInBucket(CAMS, zoneBucket('Esterno'), new Set(), zones).map((c) => c.id)).toEqual([
      2,
    ])
    expect(
      camerasInBucket(CAMS, locationBucket('Esterno'), new Set(), zones).map((c) => c.id),
    ).toEqual([1, 3])
  })
})
