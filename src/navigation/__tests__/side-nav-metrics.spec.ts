/**
 * The side rail is ICON-ONLY, at one width.
 *
 * > *"nascondiamo le labels quando la barra e' di lato"* — the operator,
 * looking at a Mac window where the rail read `Teleca…`, `Imposta…`.
 *
 * It used to have two variants: a 72pt labelled rail for tablets and wide web,
 * and a 56pt icon-only one for phone landscape "where labels would truncate".
 * The threshold was the wrong question — 72pt does not fit `Telecamere` or
 * `Impostazioni` at any window width, so the labelled variant truncated
 * wherever it appeared. A rail beside the content is a rail with no room for
 * words; the bottom bar, which has the whole width, keeps its labels.
 */
import { describe, expect, it } from 'vitest'

import { SIDE_NAV_WIDTH, sideNavFootprint } from '../side-nav-metrics.js'

describe('sideNavFootprint', () => {
  it('is one width, whatever the window', () => {
    expect(sideNavFootprint({ visible: true, insetLeft: 0 })).toBe(SIDE_NAV_WIDTH)
  })

  it('is zero when the rail is not shown', () => {
    expect(sideNavFootprint({ visible: false, insetLeft: 24 })).toBe(0)
  })

  it('adds the safe-area inset the rail actually widens by', () => {
    expect(sideNavFootprint({ visible: true, insetLeft: 24 })).toBe(SIDE_NAV_WIDTH + 24)
  })

  it('ignores an inset that is not a usable number', () => {
    expect(sideNavFootprint({ visible: true, insetLeft: Number.NaN })).toBe(SIDE_NAV_WIDTH)
    expect(sideNavFootprint({ visible: true, insetLeft: -8 })).toBe(SIDE_NAV_WIDTH)
  })

  it('is narrow enough that no label could fit — the point of the change', () => {
    expect(SIDE_NAV_WIDTH).toBeLessThanOrEqual(56)
  })
})
