import { describe, it, expect } from 'vitest'
import { parseZoneOutlines } from '../zones.js'

describe('parseZoneOutlines (the Zones overlay boundary)', () => {
  it('keeps name + points of a polygon and a two-point tripwire', () => {
    const out = parseZoneOutlines([
      { id: 'a', name: ' Porch ', kind: 'polygon', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
      { id: 'b', name: 'Gate line', kind: 'tripwire', polygon: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] },
    ])
    expect(out.map((z) => z.name)).toEqual(['Porch', 'Gate line'])
    expect(out[1]?.points).toHaveLength(2)
  })
  it('costs only the bad row: no id, too few points, junk geometry', () => {
    const out = parseZoneOutlines([
      { id: '', name: 'x', polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { id: 'few', name: 'x', polygon: [{ x: 0, y: 0 }] },
      { id: 'junk', name: 'x', polygon: [{ x: 'a', y: 0 }, null, { x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }] },
      { id: 'ok', name: '', polygon: [{ x: 2, y: -1 }, { x: 0.5, y: 0.5 }] },
    ])
    expect(out.map((z) => z.id)).toEqual(['junk', 'ok'])
    expect(out[0]?.points).toHaveLength(2)
    // blank name falls back to the id; coordinates clamp to 0..1
    expect(out[1]).toMatchObject({ name: 'ok', points: [{ x: 1, y: 0 }, { x: 0.5, y: 0.5 }] })
  })
  it('a non-array answer is no zones', () => {
    expect(parseZoneOutlines(undefined)).toEqual([])
  })
})
