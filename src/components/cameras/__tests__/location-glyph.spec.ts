/**
 * Finding a location's icon from its displayed label.
 *
 * The one thing that can be wrong here without looking wrong: the strip renders
 * the label as the operator typed it ("Kitchen") while the assignment is stored
 * under the folded key ("kitchen"). A lookup on the raw text misses and draws a
 * bare chip — indistinguishable from a location nobody styled.
 */
import { describe, expect, it } from 'vitest'

import { drawableIcon, locationIconFor, type DrawableLocationIcon } from '../location-icons.js'

const icons = new Map<string, DrawableLocationIcon>([['kitchen', 'utensils']])

describe('locationIconFor', () => {
  it('finds the icon from the label as DISPLAYED, not as stored', () => {
    expect(locationIconFor(icons, 'Kitchen')).toBe('utensils')
    expect(locationIconFor(icons, '  KITCHEN ')).toBe('utensils')
  })

  it('is null for a location nobody gave an icon — never a default', () => {
    expect(locationIconFor(icons, 'Garage')).toBeNull()
  })
})

describe('drawableIcon', () => {
  it('resolves an old spelling to its catalog key', () => {
    expect(drawableIcon('home')).toBe('house')
  })

  it('draws any catalog key, not only the retired twenty room ids', () => {
    expect(drawableIcon('telescope')).toBe('telescope')
  })

  it('falls back for an unknown value and is null for none', () => {
    expect(drawableIcon('helicopter-pad')).toBe('map-pin')
    expect(drawableIcon(null)).toBeNull()
    expect(drawableIcon('')).toBeNull()
  })
})
