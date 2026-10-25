import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { filterEventsByZone, isShapeUsable, rectShape, shapeBounds } from '../zone-filter.js'

/**
 * The zone travels as a SHAPE from the gesture to the hit test.
 *
 * The path is long and crosses four files — draw overlay → screen state →
 * timeline prop → filter — and the failure mode is silent: a polygon that
 * arrives anywhere as its bounding rect still filters, still looks plausible,
 * and quietly includes everything in the concave notch the operator drew the
 * polygon to exclude. That is the entire reason polygons exist here, so it is
 * worth a guard rather than a hope.
 *
 * Source assertions for the wiring (the viewer cannot mount a component — see
 * `docs/roadmap.md`), behavioural assertions for the logic.
 */

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('the shape survives every hop', () => {
  it('the draw overlay emits a ZoneShape, not a rect', () => {
    const src = read('components/camera/ZoneDrawOverlay.tsx')
    expect(src).toContain('onConfirm: (zone: ZoneShape) => void')
    expect(src).toContain("kind: 'polygon'")
  })

  it('the screen holds a ZoneShape', () => {
    const src = read('screens/CameraDetailScreen.tsx')
    expect(src).toContain('useState<ZoneShape | null>(null)')
  })

  it('the timeline takes a ZoneShape and logs which kind it applied', () => {
    // The rect travels inside `TimelineZoneBinding` — its own OPTIONAL group
    // inside the optional single-camera one, since 2026-09-02. A zone is drawn
    // on ONE picture: the grid page supplies no single-camera group at all, and
    // camera-detail supplies the group but withholds the zone the moment the
    // workspace wall replaces its picture.
    const bindings = read('components/camera/theater/TimelineBodyPanel.tsx')
    expect(bindings).toContain('readonly zoneRect: ZoneShape | null')
    expect(bindings).toContain('readonly zone?: TimelineZoneBinding')
    const src = read('components/camera/theater/TheaterTimeline.tsx')
    expect(src).toContain('zoneBinding?.zoneRect ?? null')
    // Without `kind` in the diagnostic, "the filter dropped too much" reads
    // identically for a polygon and for its bounding rect.
    expect(src).toContain('kind: zoneRect.kind')
  })

  it('the active overlay draws a real polygon, not its bounds', () => {
    const src = read('components/camera/ZoneActiveOverlay.tsx')
    expect(src).toContain('Polygon')
    expect(src).toContain("zone.kind === 'rect'")
  })
})

describe('shape helpers', () => {
  const square = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ] as const

  it('bounds a polygon and passes a rect through', () => {
    expect(shapeBounds({ kind: 'polygon', points: square })).toMatchObject({ x: 0.2, y: 0.2 })
    const r = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }
    expect(shapeBounds(rectShape(r))).toEqual(r)
  })

  it('rejects an unusable shape of either kind', () => {
    expect(isShapeUsable(rectShape({ x: 0, y: 0, w: 0.001, h: 0.001 }))).toBe(false)
    expect(isShapeUsable({ kind: 'polygon', points: square.slice(0, 2) })).toBe(false)
    expect(isShapeUsable({ kind: 'polygon', points: square })).toBe(true)
  })

  it('a polygon filter EXCLUDES what its bounding rect would include', () => {
    // The behavioural statement of the whole feature. An L-shaped zone, and a
    // track sitting squarely in the notch: inside the bounds, outside the zone.
    const lShape = {
      kind: 'polygon' as const,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.4, y: 0.1 },
        { x: 0.4, y: 0.6 },
        { x: 0.9, y: 0.6 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
    }
    const frame = { w: 640, h: 360 }
    const inNotch = {
      id: 'notch',
      positionBoxes: [{ x: 0.65 * frame.w, y: 0.25 * frame.h, w: 32, h: 18 }],
      normalizedEnvelope: { x: 0.65, y: 0.25, w: 0.05, h: 0.05 },
    }
    const inArm = {
      id: 'arm',
      positionBoxes: [{ x: 0.2 * frame.w, y: 0.25 * frame.h, w: 32, h: 18 }],
      normalizedEnvelope: { x: 0.2, y: 0.25, w: 0.05, h: 0.05 },
    }
    const kept = filterEventsByZone([inNotch, inArm], lShape).map((e) => e.id)
    expect(kept).toEqual(['arm'])

    // …and the bounding rect of that same polygon keeps BOTH, which is exactly
    // what a filter that lost the points would silently do.
    const bounds = shapeBounds(lShape)
    expect(bounds).not.toBeNull()
    if (bounds === null) return
    const keptByBounds = filterEventsByZone([inNotch, inArm], rectShape(bounds)).map((e) => e.id)
    expect(keptByBounds).toEqual(['notch', 'arm'])
  })
})
