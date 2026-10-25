/**
 * Reading the hub's site zones.
 *
 * The rules are all about not drawing something the operator cannot act on: a
 * zone with no key cannot be selected, a zone with no label cannot be named,
 * and an icon this build lacks must degrade rather than leave a hole.
 */
import { describe, expect, it } from 'vitest'

import { parseSiteZones } from '../use-site-zones.js'

describe('parseSiteZones', () => {
  it('keeps a usable zone, trimming its label', () => {
    const [zone] = parseSiteZones([
      { zoneKey: 'night zone', label: '  Night zone ', icon: 'bed-double', locationKeys: ['x'] },
    ])
    expect(zone).toEqual({
      zoneKey: 'night zone',
      label: 'Night zone',
      icon: 'bed-double',
      locationKeys: ['x'],
    })
  })

  it('is null-iconed when nobody chose one — never the default pin', () => {
    expect(parseSiteZones([{ zoneKey: 'z', label: 'Z', icon: null }])[0]?.icon).toBeNull()
  })

  it('degrades an icon this build cannot draw, rather than leaving a hole', () => {
    expect(parseSiteZones([{ zoneKey: 'z', label: 'Z', icon: 'helicopter-pad' }])[0]?.icon).toBe(
      'map-pin',
    )
  })

  it('drops a zone that cannot be selected or named', () => {
    expect(
      parseSiteZones([
        { label: 'Senza chiave' },
        { zoneKey: 'senza-etichetta' },
        { zoneKey: 'z', label: '   ' },
        { zoneKey: 'buona', label: 'Buona' },
      ]).map((z) => z.zoneKey),
    ).toEqual(['buona'])
  })

  it('an answer that is not a list is empty, not a throw', () => {
    expect(parseSiteZones(undefined)).toEqual([])
    expect(parseSiteZones({ zones: [] })).toEqual([])
  })

  it('tolerates junk inside locationKeys instead of losing the zone', () => {
    expect(parseSiteZones([{ zoneKey: 'z', label: 'Z', locationKeys: ['a', 3, null] }])[0]
      ?.locationKeys).toEqual(['a'])
  })
})
