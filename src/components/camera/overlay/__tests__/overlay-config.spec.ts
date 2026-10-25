import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  addReadout,
  isDefaultOverlay,
  normaliseOverlay,
  LEGACY_STATS_POSITION,
  OVERLAY_DEFAULTS,
  OVERLAY_LAYERS,
  patchOverlay,
  readoutId,
  readoutsAt,
  removeReadout,
  type CameraOverlayConfig,
  type OverlayReadout,
} from '../overlay-config.js'
import { parseLiveFields, formatLiveValue } from '../../../../data/use-device-live-fields.js'

describe('detection boxes and motion regions are two overlays, not one', () => {
  it('the layers are independent', () => {
    // They were briefly merged on the mistaken belief that only one overlay
    // existed. `motion.onMotionChanged` carries `regions[]` — the viewer was
    // simply parsing them away, so there was nothing to draw and the switch
    // looked dead. Different questions: "what is it?" vs "where did the picture
    // change?". The full layer vocabulary lives in `overlay-layers.spec.ts`.
    const config = normaliseOverlay({ boxes: true, motionBoxes: false }) as CameraOverlayConfig
    expect(config.layers).toContain('objects')
    expect(config.layers).not.toContain('motion')
  })

  it('each is drawn by its OWN component', () => {
    const screen = readFileSync(
      join(process.cwd(), 'src', 'screens', 'CameraDetailScreen.tsx'),
      'utf8',
    )
    expect(screen).toContain('MotionBoxesOverlay')
    expect(screen).toContain('MotionRegionsOverlay')
  })
})

function readout(over: Partial<OverlayReadout> = {}): OverlayReadout {
  const source = over.source ?? { kind: 'audioDbfs' as const }
  return { id: readoutId(source), source, label: 'Audio', corner: 'top-right', ...over }
}

describe('overlay config', () => {
  it('fresh cameras show the audio meter, not occupancy', () => {
    // Occupancy used to ship on (it was unconditional). The operator's call is
    // the other way around: occupancy off until asked for, the VU on at
    // top-center on both the single player and every grid tile.
    expect([...OVERLAY_DEFAULTS.layers]).toEqual([])
    expect(OVERLAY_DEFAULTS.stats).toBe('off')
    expect(OVERLAY_DEFAULTS.motionBadge).toBe('off')
    expect(OVERLAY_DEFAULTS.highlightBorder).toBe(true)
    expect(OVERLAY_DEFAULTS.occupancy).toBe('off')
    expect(OVERLAY_DEFAULTS.audioMeter).toBe('top-center')
    expect(isDefaultOverlay(OVERLAY_DEFAULTS)).toBe(true)
  })

  it('a patch never mutates its input', () => {
    const next = patchOverlay(OVERLAY_DEFAULTS, { stats: 'bottom-left' })
    expect(next.stats).toBe('bottom-left')
    expect(OVERLAY_DEFAULTS.stats).toBe('off')
  })

  it('every field has a consumer — a switch that toggles nothing is a bug', () => {
    // A field used to exist that no component implemented: its switch in the
    // panel did nothing at all, and that is exactly how it was reported.
    const screen = readFileSync(
      join(process.cwd(), 'src', 'screens', 'CameraDetailScreen.tsx'),
      'utf8',
    )
    for (const key of Object.keys(OVERLAY_DEFAULTS)) {
      if (key === 'readouts') continue // consumed by OverlayReadouts, not the screen
      // The motion pill is gone; the overlay (regions / border) is the motion
      // treatment. The field stays so stored documents still parse.
      if (key === 'motionBadge') continue
      // `layers` is read one MEMBER at a time, through `hasLayer` — the union
      // is the field, and each member must reach a drawing component.
      if (key === 'layers') {
        for (const layer of OVERLAY_LAYERS) {
          expect(screen).toContain(`hasLayer(overlay, '${layer}')`)
        }
        continue
      }
      expect(screen).toContain(`overlay.${key}`)
    }
  })

  it('pinning the same source twice replaces rather than stacks', () => {
    // Two identical chips would draw on top of each other in one corner and
    // only the top one could be removed.
    const one = addReadout(OVERLAY_DEFAULTS, readout({ corner: 'top-left' }))
    const two = addReadout(one, readout({ corner: 'bottom-right' }))
    expect(two.readouts).toHaveLength(1)
    expect(two.readouts[0]?.corner).toBe('bottom-right')
  })

  it('two different device fields coexist', () => {
    const a = readout({
      source: { kind: 'deviceField', deviceId: 7, sectionId: 's', fieldKey: 'temp' },
      label: 'Temp',
    })
    const b = readout({
      source: { kind: 'deviceField', deviceId: 7, sectionId: 's', fieldKey: 'hum' },
      label: 'Humidity',
    })
    const config = addReadout(addReadout(OVERLAY_DEFAULTS, a), b)
    expect(config.readouts).toHaveLength(2)
    expect(readoutsAt(config, 'top-right')).toHaveLength(2)
    expect(removeReadout(config, a.id).readouts).toHaveLength(1)
  })
})

describe('storage normalisation', () => {
  it('drops a single broken readout and keeps the rest of the overlay', () => {
    // A sensor removed from the system should cost its own chip, not the
    // operator's meter placement.
    const raw = {
      layers: ['motion'],
      audioMeter: 'bottom-left',
      readouts: [
        { id: 'x', source: { kind: 'deviceField', deviceId: 'not-a-number' }, label: 'Broken' },
        { id: 'y', source: { kind: 'audioDbfs' }, label: 'Audio', corner: 'top-left' },
      ],
    }
    const config = normaliseOverlay(raw) as CameraOverlayConfig
    expect([...config.layers]).toEqual(['motion'])
    expect(config.audioMeter).toBe('bottom-left')
    expect(config.readouts).toHaveLength(1)
    expect(config.readouts[0]?.label).toBe('Audio')
  })

  it('rejects an unknown meter position instead of persisting it', () => {
    const config = normaliseOverlay({ audioMeter: 'middle-of-nowhere' }) as CameraOverlayConfig
    expect(config.audioMeter).toBe(OVERLAY_DEFAULTS.audioMeter)
  })

  it('non-objects degrade to undefined, never a throw', () => {
    expect(normaliseOverlay(null)).toBeUndefined()
    expect(normaliseOverlay('nope')).toBeUndefined()
  })
})

describe('stream stats is placed like every other overlay', () => {
  // A boolean until 2026-10-07. A stored `true` must keep drawing — at the
  // corner a tile always drew it — and a stored `false` must stay off.
  it('migrates the stored boolean', () => {
    expect((normaliseOverlay({ stats: true }) as CameraOverlayConfig).stats).toBe(LEGACY_STATS_POSITION)
    expect((normaliseOverlay({ stats: false }) as CameraOverlayConfig).stats).toBe('off')
    expect((normaliseOverlay({}) as CameraOverlayConfig).stats).toBe('off')
  })

  it('keeps a chosen anchor and refuses an unknown one', () => {
    expect((normaliseOverlay({ stats: 'bottom-left' }) as CameraOverlayConfig).stats).toBe('bottom-left')
    expect((normaliseOverlay({ stats: 'somewhere' }) as CameraOverlayConfig).stats).toBe('off')
  })
})

describe('legacy camelCase corners migrate, never silently reset', () => {
  // Until 2026-08-02 the corner overlays spoke a four-value camelCase
  // vocabulary (`bottomLeft`) while the audio meter spoke the nine-value
  // kebab one. Cameras persisted in that era still hold camelCase in
  // `occupancy` and in each readout's `corner`; the unification must carry
  // them across, because "unknown value → default" would move the operator's
  // occupancy strip without a word.
  it('occupancy: a stored topRight lands on top-right (NOT the default)', () => {
    // Deliberately a NON-default corner: `bottomLeft` would land on
    // `bottom-left` even through a broken migration, because that is also the
    // default — proven when the guard was removed to check it fails.
    const config = normaliseOverlay({ occupancy: 'topRight' }) as CameraOverlayConfig
    expect(config.occupancy).toBe('top-right')
  })

  it('occupancy: every legacy corner maps to its kebab twin', () => {
    const pairs: readonly (readonly [string, string])[] = [
      ['topLeft', 'top-left'],
      ['topRight', 'top-right'],
      ['bottomLeft', 'bottom-left'],
      ['bottomRight', 'bottom-right'],
    ]
    for (const [legacy, canonical] of pairs) {
      const config = normaliseOverlay({ occupancy: legacy }) as CameraOverlayConfig
      expect(config.occupancy).toBe(canonical)
    }
  })

  it("occupancy: 'off' and the canonical form pass through; junk falls to the default", () => {
    expect((normaliseOverlay({ occupancy: 'off' }) as CameraOverlayConfig).occupancy).toBe('off')
    expect((normaliseOverlay({ occupancy: 'top-center' }) as CameraOverlayConfig).occupancy).toBe(
      'top-center',
    )
    expect((normaliseOverlay({ occupancy: 'middle' }) as CameraOverlayConfig).occupancy).toBe(
      OVERLAY_DEFAULTS.occupancy,
    )
  })

  it("a readout's legacy corner migrates; junk re-anchors to top-right", () => {
    const raw = {
      readouts: [
        { id: 'a', source: { kind: 'audioDbfs' }, label: 'Audio', corner: 'bottomLeft' },
        {
          id: 'b',
          source: { kind: 'deviceField', deviceId: 7, sectionId: 's', fieldKey: 'temp' },
          label: 'Temp',
          corner: 'nowhere',
        },
      ],
    }
    const config = normaliseOverlay(raw) as CameraOverlayConfig
    expect(config.readouts[0]?.corner).toBe('bottom-left')
    expect(config.readouts[1]?.corner).toBe('top-right')
  })
})

describe('live fields', () => {
  it('keeps scalar readings and drops widgets', () => {
    // A group, a button or an editor is not something to draw over a picture,
    // and each would render as an empty chip if it slipped through.
    const fields = parseLiveFields({
      sections: [
        {
          id: 'env',
          title: 'Environment',
          fields: [
            { key: 'temp', label: 'Temperature', value: 21.4, unit: '°C', precision: 1 },
            { key: 'act', label: 'Reboot', type: 'button' },
            { key: 'grp', label: 'Advanced', value: { nested: true } },
          ],
        },
      ],
    })
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ key: 'temp', unit: '°C', sectionTitle: 'Environment' })
  })

  it('an absent or malformed aggregate is an empty catalogue', () => {
    expect(parseLiveFields(null)).toEqual([])
    expect(parseLiveFields({ sections: 'nope' })).toEqual([])
  })

  it('a boolean reads as words, not as "true"', () => {
    expect(formatLiveValue(true, { onLabel: 'On', offLabel: 'Off' })).toBe('On')
    expect(formatLiveValue(21.44, { precision: 1, unit: '°C', onLabel: 'On', offLabel: 'Off' })).toBe(
      '21.4 °C',
    )
    expect(formatLiveValue(null, { onLabel: 'On', offLabel: 'Off' })).toBe('—')
  })
})

describe('the motion badge became a position, and old values must survive it', () => {
  // It was a boolean pinned to the top-right. Falling back to the default for
  // a stored boolean would switch the badge back ON for an operator who had
  // turned it off — a setting silently undone by a refactor.
  it('a stored `true` lands where the badge always drew', () => {
    expect((normaliseOverlay({ motionBadge: true }) as CameraOverlayConfig).motionBadge).toBe(
      'top-right',
    )
  })

  it('a stored `false` becomes off, NOT the default', () => {
    expect((normaliseOverlay({ motionBadge: false }) as CameraOverlayConfig).motionBadge).toBe('off')
  })

  it('a position passes through, and junk falls back to the default', () => {
    expect((normaliseOverlay({ motionBadge: 'bottom-left' }) as CameraOverlayConfig).motionBadge).toBe(
      'bottom-left',
    )
    expect((normaliseOverlay({ motionBadge: 'nowhere' }) as CameraOverlayConfig).motionBadge).toBe(
      OVERLAY_DEFAULTS.motionBadge,
    )
  })

  it('the legacy camelCase spelling migrates here too', () => {
    expect((normaliseOverlay({ motionBadge: 'bottomRight' }) as CameraOverlayConfig).motionBadge).toBe(
      'bottom-right',
    )
  })

  it('the motion pill is not mounted — the overlay is the motion treatment', () => {
    const screen = readFileSync(join(process.cwd(), 'src', 'screens', 'CameraDetailScreen.tsx'), 'utf8')
    const card = readFileSync(join(process.cwd(), 'src', 'components', 'CameraCard.tsx'), 'utf8')
    const tile = readFileSync(join(process.cwd(), 'src', 'components', 'grid', 'GridTile.tsx'), 'utf8')
    const embed = readFileSync(
      join(process.cwd(), 'embed', 'src', 'components', 'GridTilePlayer.tsx'),
      'utf8',
    )
    const listSheet = readFileSync(
      join(process.cwd(), 'src', 'components', 'camera', 'CamerasDisplaySheet.tsx'),
      'utf8',
    )
    expect(screen).not.toContain('<MotionBadge')
    expect(card).not.toContain('<MotionBadge')
    expect(tile).not.toContain('<MotionBadge')
    expect(embed).not.toContain('<TileMotionBadge')
    expect(listSheet).not.toContain('listMotionBadge')
  })
})

describe('one placement map, not one per overlay', () => {
  it('the readouts and the badge both use ANCHOR_PLACEMENT', () => {
    const readouts = readFileSync(
      join(process.cwd(), 'src', 'components', 'camera', 'overlay', 'OverlayReadouts.tsx'),
      'utf8',
    )
    const badge = readFileSync(
      join(process.cwd(), 'src', 'components', 'camera', 'MotionBadge.tsx'),
      'utf8',
    )
    expect(readouts).toContain('ANCHOR_PLACEMENT')
    expect(badge).toContain('ANCHOR_PLACEMENT')
    // The private copy that used to live in OverlayReadouts is gone.
    expect(readouts).not.toContain('CORNER_STYLE')
  })
})

describe('live viewers is placed like every other overlay', () => {
  it('is off for a camera that never placed it, and an old document stays default', () => {
    expect(OVERLAY_DEFAULTS.viewers).toBe('off')
    expect((normaliseOverlay({}) as CameraOverlayConfig).viewers).toBe('off')
    expect(isDefaultOverlay(OVERLAY_DEFAULTS)).toBe(true)
  })

  it('keeps a stored position, and rejects junk back to off', () => {
    expect((normaliseOverlay({ viewers: 'bottom-right' }) as CameraOverlayConfig).viewers).toBe(
      'bottom-right',
    )
    expect((normaliseOverlay({ viewers: 'somewhere' }) as CameraOverlayConfig).viewers).toBe('off')
    expect((normaliseOverlay({ viewers: true }) as CameraOverlayConfig).viewers).toBe('off')
  })

  it('a camera that placed it is no longer the default document (so it is persisted)', () => {
    expect(isDefaultOverlay({ ...OVERLAY_DEFAULTS, viewers: 'top-left' })).toBe(false)
  })
})

