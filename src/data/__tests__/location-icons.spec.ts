/**
 * Reading the server's location→icon rows.
 *
 * The rule under test is that ABSENCE survives the parse. Every shortcut here
 * (a null icon folded into the fallback, a junk row rejecting the whole map)
 * ends with the picker unable to tell "the operator chose the pin" from "nobody
 * chose anything" — which is the one distinction the feature is built on.
 */
import { describe, expect, it } from 'vitest'

import { parseLocationIcons } from '../use-location-icons.js'

describe('parseLocationIcons', () => {
  it('keys by the folded label, so a case-only rename keeps its icon', () => {
    const map = parseLocationIcons([{ locationKey: ' Kitchen ', icon: 'utensils' }])
    expect(map.get('kitchen')).toBe('utensils')
  })

  it('degrades an id this build cannot draw to the fallback, never to a blank', () => {
    const map = parseLocationIcons([{ locationKey: 'tetto', icon: 'helicopter-pad' }])
    expect(map.get('tetto')).toBe('map-pin')
  })

  it('does NOT invent an assignment from a row with no icon', () => {
    // The fallback belongs to an UNKNOWN id. Applying it to a missing one turns
    // "nobody chose" into "the pin was chosen" — the exact confusion the server
    // avoids by omitting unassigned locations altogether.
    const map = parseLocationIcons([
      { locationKey: 'garage', icon: null },
      { locationKey: 'sala' },
    ])
    expect(map.has('garage')).toBe(false)
    expect(map.has('sala')).toBe(false)
  })

  it('drops the junk row and keeps the good ones', () => {
    const map = parseLocationIcons([
      { locationKey: 'garden', icon: 'trees' },
      null,
      42,
      { icon: 'car' },
      { locationKey: '', icon: 'car' },
      { locationKey: 'box', icon: 'car' },
    ])
    expect([...map.keys()].sort()).toEqual(['box', 'garden'])
  })

  it('an answer that is not a list is an empty map, not a throw', () => {
    // An older hub has no such method; the query already fails in that case.
    // This is the softer shape — a hub that answers with something unexpected.
    expect(parseLocationIcons(undefined).size).toBe(0)
    expect(parseLocationIcons({ rows: [] }).size).toBe(0)
  })
})
