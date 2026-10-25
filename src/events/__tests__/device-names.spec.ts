/**
 * The rename dictionary handed to the embed.
 *
 * Renaming a camera in this app is CLIENT-SIDE — `camera-prefs-store` holds a
 * `localName` per id and `useCameras` applies it as `name` while keeping the
 * server's value in `originalName`. Nothing is written back to the hub, so the
 * embed (which resolves its own labels from the server) showed the original
 * names and had no way not to. These are the two rules that make handing them
 * over correct rather than merely possible.
 */
import { describe, it, expect } from 'vitest'
import { deviceNamesFromCameras, pickDeviceNames } from '../device-names.js'
import { encodeDeviceNames } from '../../../shared/events/events-share-url.js'

const cam = (id: number, name: string, originalName = name) => ({ id, name, originalName })

describe('deviceNamesFromCameras', () => {
  it('carries ONLY the cameras the operator actually renamed', () => {
    // Sending every camera would pin the viewer's copy of a name over whatever
    // the hub knows — so a camera renamed on the SERVER would keep showing the
    // stale one. An override overrides what was overridden, nothing else.
    const names = deviceNamesFromCameras([
      cam(101, 'Front door', 'Camera front door'),
      cam(102, 'Camera garage'),
      cam(104, 'Hall', 'Camera hall'),
    ])
    expect(names).toEqual({ '101': 'Front door', '104': 'Hall' })
  })

  it('is empty when nothing is renamed', () => {
    expect(deviceNamesFromCameras([cam(1, 'A'), cam(2, 'B')])).toEqual({})
  })

  it('keys by STRINGIFIED id — what the config and the URL param both use', () => {
    const names = deviceNamesFromCameras([cam(7, 'Nuovo', 'Vecchio')])
    expect(Object.keys(names)).toEqual(['7'])
  })

  it('ignores a blank rename and whitespace-only differences', () => {
    expect(deviceNamesFromCameras([cam(1, '   ', 'Real')])).toEqual({})
    expect(deviceNamesFromCameras([cam(2, ' Same ', 'Same')])).toEqual({})
  })
})

describe('pickDeviceNames — a link names only what it shows', () => {
  const all = { '101': 'Front door', '102': 'Garage', '104': 'Hall' }

  it('narrows to the link’s cameras', () => {
    // These are the operator's private labels and the link goes to someone
    // else; a link scoped to one camera has no business naming the others.
    expect(pickDeviceNames(all, [101])).toEqual({ '101': 'Front door' })
  })

  it('carries everything when the link means "all cameras"', () => {
    expect(pickDeviceNames(all, [])).toEqual(all)
  })

  it('drops ids that carry no rename', () => {
    expect(pickDeviceNames(all, [101, 999])).toEqual({ '101': 'Front door' })
  })

  it('copies rather than aliasing the source', () => {
    const out = pickDeviceNames(all, [])
    out['101'] = 'mutated'
    expect(all['101']).toBe('Front door')
  })
})

/**
 * MIRROR of `encodeDeviceNames` in the Viewer embed's `events-url-config.ts`,
 * where the parser lives. The vectors below are the ones that break a naive
 * implementation.
 */
describe('encodeDeviceNames — the names= param', () => {
  it('emits <id>:<name> joined by commas', () => {
    // Order is NOT asserted: integer-like keys iterate in ascending numeric
    // order regardless of insertion (so this comes out 104 first), and the
    // parser is order-independent anyway. Pinning the order here would be
    // testing V8, not the encoding.
    const encoded = encodeDeviceNames({ '101': 'Front door', '104': 'Hall' })
    expect(encoded.split(',').sort()).toEqual(['101:Front%20door', '104:Hall'])
  })

  it('percent-encodes each name INDIVIDUALLY so a comma survives the split', () => {
    // "Garage, retro" is the case: the parser splits on commas first, so an
    // unencoded name would silently become two malformed entries.
    expect(encodeDeviceNames({ '102': 'Garage, retro' })).toBe('102:Garage%2C%20retro')
  })

  it('leaves the id plain — the parser expects digits', () => {
    expect(encodeDeviceNames({ '7': 'A' }).startsWith('7:')).toBe(true)
  })

  it('encodes a colon in the name so the id split stays unambiguous', () => {
    // The parser splits at the FIRST colon, so this one is safe either way —
    // but encoding it keeps the value readable as one field.
    expect(encodeDeviceNames({ '1': 'a:b' })).toBe('1:a%3Ab')
  })

  it('drops entries the parser would skip anyway', () => {
    expect(encodeDeviceNames({ abc: 'X', '2': '   ', '3': 'Ok' })).toBe('3:Ok')
  })

  it('an EMPTY dictionary encodes to the empty string', () => {
    // `names=` is a valid EMPTY dictionary — "no renames", said explicitly,
    // as distinct from not mentioning renames at all.
    expect(encodeDeviceNames({})).toBe('')
  })
})
