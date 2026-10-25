import { describe, it, expect } from 'vitest'
import {
  OVERLAY_DEFAULTS,
  OVERLAY_LAYERS,
  hasLayer,
  isDefaultOverlay,
  normaliseOverlay,
  toggleLayer,
  type CameraOverlayConfig,
  type OverlayLayer,
} from '../overlay-config.js'

/**
 * The box overlay is a CHECKABLE SET of four independent layers, not an ordered
 * scale.
 *
 * The scale it replaces (`off` / `kept` / `all`) forced `discarded ⊃ objects`
 * and had no rung at all for the parked objects — so the stationary boxes rode
 * the object-detection switch, which defaults OFF. A fresh install could not
 * draw a parked car, and no operator could ask for "parked only".
 *
 * The four are independent BY CONSTRUCTION:
 *   • motion      — `motion.onMotionChanged` regions, a different data plane;
 *   • objects     — `FrameResult.detections` (the survivors);
 *   • discarded   — the complement on the SAME frame (`filterRelevantDiscards`);
 *   • stationary  — the hub SUPPRESSES a parked object's detection
 *     (`SUPPRESS_IOU`, server `stationary-registry.ts`), so a parked object can
 *     never arrive through `objects` or `discarded`.
 */
const config = (raw: unknown): CameraOverlayConfig => normaliseOverlay(raw) as CameraOverlayConfig

describe('the layer vocabulary', () => {
  it('is exactly the four independent layers, in display order', () => {
    expect([...OVERLAY_LAYERS]).toEqual(['motion', 'objects', 'discarded', 'stationary'])
  })

  it('draws nothing by default — the overlay is opt-in, as it always was', () => {
    expect([...OVERLAY_DEFAULTS.layers]).toEqual([])
    expect(isDefaultOverlay(OVERLAY_DEFAULTS)).toBe(true)
  })

  it('toggles one layer without disturbing the others', () => {
    const on = toggleLayer(OVERLAY_DEFAULTS, 'stationary')
    expect(hasLayer(on, 'stationary')).toBe(true)
    expect(hasLayer(on, 'objects')).toBe(false)
    // Immutable: the default document is untouched.
    expect([...OVERLAY_DEFAULTS.layers]).toEqual([])
    const off = toggleLayer(on, 'stationary')
    expect([...off.layers]).toEqual([])
  })

  it('keeps a toggled-on set in canonical order, whatever order it was clicked', () => {
    let c = OVERLAY_DEFAULTS
    for (const layer of ['stationary', 'motion', 'discarded'] as const) c = toggleLayer(c, layer)
    expect([...c.layers]).toEqual(['motion', 'discarded', 'stationary'])
  })

  it('lets stationary be asked for ALONE — the whole point of the re-scope', () => {
    // Under the retired scale this state was inexpressible: the parked boxes
    // only drew while the object-detection rung was up.
    const only = toggleLayer(OVERLAY_DEFAULTS, 'stationary')
    expect([...only.layers]).toEqual(['stationary'])
    expect(isDefaultOverlay(only)).toBe(false)
  })

  it('lets discarded be asked for WITHOUT objects — impossible on an ordered scale', () => {
    const c = toggleLayer(OVERLAY_DEFAULTS, 'discarded')
    expect(hasLayer(c, 'discarded')).toBe(true)
    expect(hasLayer(c, 'objects')).toBe(false)
  })
})

/**
 * ## The migration table
 *
 * An operator sitting on `boxes: 'kept'` today IS SEEING parked boxes — they
 * ride that switch. The migration must preserve what the screen DRAWS, not what
 * the field was called:
 *
 *   stored                          | layers
 *   ------------------------------- | ------------------------------------
 *   boxes: 'off'                    | —
 *   boxes: 'kept'                   | objects, stationary
 *   boxes: 'all'                    | objects, discarded, stationary
 *   boxes: true   (legacy boolean)  | objects, stationary
 *   boxes: false  (legacy boolean)  | —
 *   discardedBoxes: true            | objects, discarded, stationary
 *   motionBoxes: true               | + motion
 *   junk / absent                   | —
 */
describe('migration preserves the picture, not the vocabulary', () => {
  const CASES: readonly (readonly [string, unknown, readonly OverlayLayer[]])[] = [
    ["boxes: 'off'", { boxes: 'off' }, []],
    ["boxes: 'kept' still draws the parked objects it drew", { boxes: 'kept' }, ['objects', 'stationary']],
    ["boxes: 'all'", { boxes: 'all' }, ['objects', 'discarded', 'stationary']],
    ['legacy boolean true', { boxes: true }, ['objects', 'stationary']],
    ['legacy boolean false', { boxes: false }, []],
    ['legacy discardedBoxes wins over a false boxes', { boxes: false, discardedBoxes: true }, ['objects', 'discarded', 'stationary']],
    ['motionBoxes adds the motion layer', { boxes: 'kept', motionBoxes: true }, ['motion', 'objects', 'stationary']],
    ['motionBoxes alone', { motionBoxes: true }, ['motion']],
    ['junk falls to nothing', { boxes: 'everything' }, []],
    ['an absent document falls to nothing', {}, []],
  ]

  for (const [name, raw, expected] of CASES) {
    it(name, () => {
      expect([...config(raw).layers]).toEqual([...expected])
    })
  }

  it('a migrated legacy document is never mistaken for the defaults', () => {
    // `isDefaultOverlay` decides whether the store persists anything at all —
    // a false positive here silently discards the operator's choice.
    expect(isDefaultOverlay(config({ boxes: 'kept' }))).toBe(false)
    expect(isDefaultOverlay(config({ motionBoxes: true }))).toBe(false)
    expect(isDefaultOverlay(config({ discardedBoxes: true }))).toBe(false)
  })

  it('an already-migrated document passes through, deduped and ordered', () => {
    expect([...config({ layers: ['stationary', 'motion', 'stationary'] }).layers]).toEqual([
      'motion',
      'stationary',
    ])
  })

  it('drops a layer name it does not know instead of rejecting the document', () => {
    const c = config({ layers: ['objects', 'zombies'], audioMeter: 'top-left' })
    expect([...c.layers]).toEqual(['objects'])
    expect(c.audioMeter).toBe('top-left')
  })

  it('a canonical `layers` is authoritative — the retired fields never override it', () => {
    expect([...config({ layers: [], boxes: 'all', motionBoxes: true }).layers]).toEqual([])
  })

  it('the retired fields are not on the migrated document', () => {
    // A second switch that disagrees with the first is worse than no switch.
    const keys = Object.keys(config({ boxes: 'all', motionBoxes: true, discardedBoxes: true }))
    expect(keys).not.toContain('boxes')
    expect(keys).not.toContain('motionBoxes')
    expect(keys).not.toContain('discardedBoxes')
    expect(Object.keys(OVERLAY_DEFAULTS)).not.toContain('boxes')
    expect(Object.keys(OVERLAY_DEFAULTS)).not.toContain('motionBoxes')
  })
})
