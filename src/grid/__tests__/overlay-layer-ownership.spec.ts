import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BAR_LAYERS,
  GRID_ROW_OWNER,
  LAYER_ROW,
  ROW_GROUP,
  VIEW_OPTION_ROWS,
  visibleLayers,
} from '../view-options-scope.js'
import {
  LAYER_LABEL_KEY,
  OVERLAY_LAYERS,
  type OverlayLayer,
} from '../../components/camera/overlay/overlay-config.js'

/**
 * The four layers are ONE control, but they are not ONE owner.
 *
 * Folding motion into the same chip row would promote it from per-camera
 * (`cell`) to wall-wide (`bar`) on the grid — and the tiles ALREADY paint motion
 * regions from each camera's own document. Promoting it would mean either the
 * bar writing N camera documents (the "one picture, two documents" bug this
 * module exists to end) or silently dropping a capability that ships today.
 *
 * So: two REGISTRY rows, one RENDERED control. The panel asks which layers are
 * visible in its context and draws that many chips — four in the single-camera
 * view, one (motion) in a grid cell, three in the grid bar.
 */
const ROOT = process.cwd()
const read = (...rel: readonly string[]): string => readFileSync(join(ROOT, ...rel), 'utf8')

describe('every layer is owned, exactly once', () => {
  it('maps every layer onto a row that exists', () => {
    expect(Object.keys(LAYER_ROW).sort()).toEqual([...OVERLAY_LAYERS].sort())
    for (const layer of OVERLAY_LAYERS) {
      expect(VIEW_OPTION_ROWS).toContain(LAYER_ROW[layer])
    }
  })

  it('keeps every layer in the detection group — they are one control', () => {
    for (const layer of OVERLAY_LAYERS) {
      expect(ROW_GROUP[LAYER_ROW[layer]]).toBe('detection')
    }
  })

  it('keeps MOTION per-camera and the detector layers wall-wide', () => {
    // The judgement call, pinned. Motion is the one layer a tile paints from
    // the camera's own document, so the bar must not claim it.
    expect(GRID_ROW_OWNER[LAYER_ROW.motion]).toBe('cell')
    for (const layer of ['objects', 'discarded', 'stationary'] as const) {
      expect(GRID_ROW_OWNER[LAYER_ROW[layer]]).toBe('bar')
    }
  })

  it('offers all four in the single view, and splits them on the wall', () => {
    expect([...visibleLayers('single')]).toEqual(['motion', 'objects', 'discarded', 'stationary'])
    expect([...visibleLayers('grid-cell')]).toEqual(['motion'])
    expect([...BAR_LAYERS]).toEqual(['objects', 'discarded', 'stationary'])
  })

  it('never offers the same layer in both grid menus', () => {
    const cell = new Set(visibleLayers('grid-cell'))
    expect(BAR_LAYERS.filter((layer) => cell.has(layer))).toEqual([])
  })

  it('loses no layer between the two grid surfaces', () => {
    expect([...visibleLayers('grid-cell'), ...BAR_LAYERS].sort()).toEqual([...OVERLAY_LAYERS].sort())
  })
})

describe('a layer the normaliser accepts but no panel offers is unreachable', () => {
  // The spirit of the guard the retired tri-state carried: the "(diagnostic)"
  // toggle that nothing offered is what made the discarded ghosts unfindable.
  it('the single-camera panel drives its chips off the shared list', () => {
    const panel = read('src', 'components', 'camera', 'theater', 'TimelineOverlayPanel.tsx')
    expect(panel).toContain('visibleLayers(context)')
    expect(panel).toContain('<OverlayLayersRow')
  })

  it('the grid bar draws exactly the layers it owns', () => {
    const panel = read('src', 'components', 'grid', 'GridMenuPanel.tsx')
    expect(panel).toContain('BAR_LAYERS')
    expect(panel).toContain('<OverlayLayersRow')
  })

  it('is a CHECKABLE SET — never a SegmentedControl, never an ordered scale', () => {
    // Four independent booleans. A single-value control cannot express
    // "stationary only", which is exactly the state the operator asked for.
    for (const file of [
      ['src', 'components', 'camera', 'theater', 'TimelineOverlayPanel.tsx'],
      ['src', 'components', 'grid', 'GridMenuPanel.tsx'],
      ['src', 'components', 'camera', 'overlay', 'OverlayLayersRow.tsx'],
    ] as const) {
      const src = read(...file)
      expect(src).not.toContain('SegmentedControl')
      expect(src).not.toContain("value: 'kept'")
      expect(src).not.toContain("value: 'all'")
    }
  })

  it('the retired tri-state vocabulary is gone from the app', () => {
    for (const file of [
      ['src', 'components', 'camera', 'overlay', 'overlay-config.ts'],
      ['src', 'store', 'grid-store.ts'],
      ['src', 'screens', 'GridViewScreen.tsx'],
      ['src', 'screens', 'CameraDetailScreen.tsx'],
    ] as const) {
      expect(read(...file)).not.toContain('OverlayBoxesMode')
    }
  })
})

describe('every layer is named, in both languages', () => {
  const locales = ['en', 'it'] as const

  function lookup(bundle: unknown, key: string): unknown {
    return key.split('.').reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined,
      bundle,
    )
  }

  it('has a non-empty label for every layer in every locale', () => {
    for (const locale of locales) {
      const bundle: unknown = JSON.parse(read('locales', `${locale}.json`))
      for (const layer of OVERLAY_LAYERS) {
        const label = lookup(bundle, LAYER_LABEL_KEY[layer])
        expect(typeof label, `${locale}: ${LAYER_LABEL_KEY[layer]}`).toBe('string')
        expect(String(label).length, `${locale}: ${LAYER_LABEL_KEY[layer]}`).toBeGreaterThan(0)
      }
    }
  })

  it("uses the operator's own word for the parked layer in Italian", () => {
    // He says "stazionarie"; the box tag said "fermo Xm". One vocabulary.
    const it: unknown = JSON.parse(read('locales', 'it.json'))
    expect(String(lookup(it, LAYER_LABEL_KEY.stationary)).toLowerCase()).toContain('stazionar')
    expect(String(lookup(it, 'v2.cameras.stationaryFor')).toLowerCase()).toContain('stazionar')
  })

  it('retires the keys the ordered scale owned', () => {
    for (const locale of locales) {
      const bundle: unknown = JSON.parse(read('locales', `${locale}.json`))
      const retiredKeys = [
        // The ordered scale's own labels…
        'v2.overlay.boxesOff',
        'v2.overlay.boxesKept',
        'v2.overlay.boxesAll',
        'v2.overlay.boxesAllHint',
        // …the separate motion toggle's label and the row title it sat under…
        'v2.overlay.motionBoxes',
        'v2.cameraMenu.boundingBoxes',
        'v2.cameraDetail.motionBoxes',
        // …and the box tag that used a second word for the same thing.
        'v2.cameras.parkedFor',
      ]
      for (const retired of retiredKeys) {
        expect(lookup(bundle, retired), `${locale}: ${retired}`).toBeUndefined()
      }
    }
  })

  it('keeps the two locale files in step — no layer key in one only', () => {
    const en: unknown = JSON.parse(read('locales', 'en.json'))
    const itBundle: unknown = JSON.parse(read('locales', 'it.json'))
    const keys: readonly string[] = [
      ...OVERLAY_LAYERS.map((l: OverlayLayer) => LAYER_LABEL_KEY[l]),
      'v2.overlay.layersLabel',
      'v2.overlay.layerDiscardedHint',
      'v2.overlay.layerStationaryHint',
    ]
    for (const key of keys) {
      expect(typeof lookup(en, key), `en: ${key}`).toBe('string')
      expect(typeof lookup(itBundle, key), `it: ${key}`).toBe('string')
    }
  })
})
