import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { zonePillAction, rectShape } from '../zone-filter.js'

const THEATER = join(__dirname, '..')
const read = (f: string): string => readFileSync(join(THEATER, f), 'utf8')

describe('the floating zone pill', () => {
  it('is lit while drawing OR while a zone filter is applied', () => {
    const src = read('TheaterTimeline.tsx')
    expect(src).toMatch(/zoneActive:\s*zoneRect !== null \|\| zoneBinding\?\.drawing === true/)
    expect(read('TimelineBodyPanel.tsx')).toMatch(/readonly drawing: boolean/)
    expect(read('../../../screens/CameraDetailScreen.tsx')).toMatch(/drawing: zoneDrawing/)
  })

  it('is a toggle in both directions: idle starts, drawing or a zone turns the flow off', () => {
    const zone = rectShape({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
    expect(zonePillAction(false, null)).toBe('draw')
    expect(zonePillAction(true, null)).toBe('off')
    expect(zonePillAction(false, zone)).toBe('off')
    expect(zonePillAction(true, zone)).toBe('off')
    expect(read('TheaterTimeline.tsx')).toMatch(/zonePillAction\(zoneBinding\.drawing, zoneRect\) === 'off'/)
  })

  it('turning it off cancels the drawing AND clears the zone', () => {
    const src = read('../../../screens/CameraDetailScreen.tsx')
    expect(src).toMatch(/const onClearZone = useCallback\(\(\) => \{\s*setZoneDrawing\(false\)\s*setTimelineZone\(null\)/)
  })
})
