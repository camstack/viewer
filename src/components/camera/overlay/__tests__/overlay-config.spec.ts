import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  addReadout,
  doorbellBadgeEnabled,
  FADE_DEFAULTS,
  FADEABLE_OVERLAYS,
  isDefaultOverlay,
  isOverlayShown,
  OVERLAY_DEFAULTS,
  parseOverlayConfig,
  patchOverlay,
  patchReadout,
  placeOverlay,
  readoutId,
  readoutsAt,
  readoutsForCamera,
  removeReadout,
  setFade,
  type OverlayReadout,
} from '../overlay-config.js'
import { parseLiveFields, formatLiveValue } from '../../../../data/use-device-live-fields.js'

function readout(over: Partial<OverlayReadout> = {}): OverlayReadout {
  const source = over.source ?? { kind: 'cameraField' as const, sectionId: 'sensors', fieldKey: 'temp' }
  return { id: readoutId(source), source, label: 'Audio', corner: 'top-right', ...over }
}

describe('the defaults of the one global overlay document', () => {
  it('the camera name is an overlay, on at the top-left, and it fades with the controls', () => {
    expect(OVERLAY_DEFAULTS.cameraName).toBe('top-left')
    expect(OVERLAY_DEFAULTS.fade.cameraName).toBe(true)
  })

  it('no other overlay fades by default', () => {
    for (const id of FADEABLE_OVERLAYS) {
      expect(FADE_DEFAULTS[id], id).toBe(id === 'cameraName')
    }
  })

  it('the motion pill fades like every other overlay, and the doorbell badge has a corner (planning#745)', () => {
    expect(FADEABLE_OVERLAYS).toContain('motionBadge')
    expect(OVERLAY_DEFAULTS.doorbellAnchor).toBe('top-left')
    expect(parseOverlayConfig({ doorbellAnchor: 'bottom-right' }).doorbellAnchor).toBe('bottom-right')
    expect(parseOverlayConfig({ doorbellAnchor: 'off' }).doorbellAnchor).toBe('top-left')
    expect(parseOverlayConfig({ fade: { motionBadge: true } }).fade.motionBadge).toBe(true)
    expect(isDefaultOverlay(parseOverlayConfig({ doorbellAnchor: 'bottom-right' }))).toBe(false)
  })
})

describe('the audio readout is retired into the audio meter (planning#745)', () => {
  // The marker is the readout's CORNER: a corner nothing defaults to, so a
  // migration that only switched the meter back on to its default would fail.
  const stored = {
    audioMeter: 'off',
    readouts: [
      { id: 'audio-dbfs', source: { kind: 'audioDbfs' }, label: 'Audio', unit: 'dBFS', corner: 'bottom-left' },
      { id: 'cam:s:f', source: { kind: 'cameraField', sectionId: 's', fieldKey: 'f' }, label: 'Temp', corner: 'top-right' },
    ],
  }

  it('a user who had the readout on and the meter off gets the meter on, at the readout corner', () => {
    const config = parseOverlayConfig(stored)
    expect(config.audioMeter).toBe('bottom-left')
    expect(config.readouts.map((r) => r.id)).toEqual(['cam:s:f'])
  })

  it('a meter the user had placed stays where it was', () => {
    expect(parseOverlayConfig({ ...stored, audioMeter: 'top-right' }).audioMeter).toBe('top-right')
  })

  it('a meter that was off and no readout stays off', () => {
    expect(parseOverlayConfig({ audioMeter: 'off', readouts: [] }).audioMeter).toBe('off')
  })

  it('the readout fade carries to the meter fade', () => {
    const faded = { ...stored, readouts: [{ ...stored.readouts[0], fade: true }] }
    expect(parseOverlayConfig(faded).fade.audioMeter).toBe(true)
  })

  it('the control groups default to the bottom corners, left and right', () => {
    expect(OVERLAY_DEFAULTS.controlsLeft).toBe('bottom-left')
    expect(OVERLAY_DEFAULTS.controlsRight).toBe('bottom-right')
  })

  it('fresh installs show the audio meter, not occupancy', () => {
    expect([...OVERLAY_DEFAULTS.layers]).toEqual([])
    expect(OVERLAY_DEFAULTS.stats).toBe('off')
    expect(OVERLAY_DEFAULTS.occupancy).toBe('off')
    expect(OVERLAY_DEFAULTS.viewers).toBe('off')
    expect(OVERLAY_DEFAULTS.doorbell).toBe(false)
    expect(OVERLAY_DEFAULTS.highlightBorder).toBe(true)
    expect(OVERLAY_DEFAULTS.audioMeter).toBe('top-center')
    expect(isDefaultOverlay(OVERLAY_DEFAULTS)).toBe(true)
  })

  it('a patch never mutates its input', () => {
    const next = patchOverlay(OVERLAY_DEFAULTS, { stats: 'bottom-left' })
    expect(next.stats).toBe('bottom-left')
    expect(OVERLAY_DEFAULTS.stats).toBe('off')
  })

  it('any change makes it a non-default document (so it is persisted)', () => {
    expect(isDefaultOverlay(placeOverlay(OVERLAY_DEFAULTS, 'cameraName', 'off'))).toBe(false)
    expect(isDefaultOverlay(setFade(OVERLAY_DEFAULTS, 'cameraName', false))).toBe(false)
    expect(isDefaultOverlay({ ...OVERLAY_DEFAULTS, controlsLeft: 'top-left' })).toBe(false)
    expect(isDefaultOverlay({ ...OVERLAY_DEFAULTS, viewers: 'top-left' })).toBe(false)
  })
})

describe('placing an overlay', () => {
  it('moves it and appends it to the order, so the order is the placing order', () => {
    const a = placeOverlay(OVERLAY_DEFAULTS, 'stats', 'top-left')
    const b = placeOverlay(a, 'occupancy', 'top-left')
    expect(b.stats).toBe('top-left')
    expect([...b.order]).toEqual(['stats', 'occupancy'])
    // Placing again moves it to the end — never duplicates it.
    expect([...placeOverlay(b, 'stats', 'bottom-right').order]).toEqual(['occupancy', 'stats'])
  })

  it('switching off leaves the order alone', () => {
    const a = placeOverlay(OVERLAY_DEFAULTS, 'stats', 'top-left')
    expect([...placeOverlay(a, 'stats', 'off').order]).toEqual(['stats'])
  })

  it('a control group can move but never be switched off', () => {
    expect(placeOverlay(OVERLAY_DEFAULTS, 'controlsLeft', 'off')).toBe(OVERLAY_DEFAULTS)
    expect(placeOverlay(OVERLAY_DEFAULTS, 'controlsLeft', 'top-left').controlsLeft).toBe('top-left')
    expect(placeOverlay(OVERLAY_DEFAULTS, 'controlsRight', 'top-right').controlsRight).toBe('top-right')
  })
})

describe('fade: an overlay hides with the auto-hiding controls', () => {
  it('follows controlsVisible only when its flag is on', () => {
    // Camera name: fade ON by default.
    expect(isOverlayShown(OVERLAY_DEFAULTS, 'cameraName', true)).toBe(true)
    expect(isOverlayShown(OVERLAY_DEFAULTS, 'cameraName', false)).toBe(false)
    // Everything else stays while the controls are gone.
    expect(isOverlayShown(OVERLAY_DEFAULTS, 'stats', false)).toBe(true)
    expect(isOverlayShown(OVERLAY_DEFAULTS, 'audioMeter', false)).toBe(true)
  })

  it('a flag turned on makes that overlay follow the controls', () => {
    const c = setFade(OVERLAY_DEFAULTS, 'stats', true)
    expect(isOverlayShown(c, 'stats', false)).toBe(false)
    expect(isOverlayShown(c, 'stats', true)).toBe(true)
    // …and turned off lets the camera name stay.
    expect(isOverlayShown(setFade(OVERLAY_DEFAULTS, 'cameraName', false), 'cameraName', false)).toBe(true)
  })

  it('setFade never mutates its input', () => {
    setFade(OVERLAY_DEFAULTS, 'stats', true)
    expect(OVERLAY_DEFAULTS.fade.stats).toBe(false)
  })

  it('the control groups and the device pill are not decided by a flag', () => {
    expect(isOverlayShown(OVERLAY_DEFAULTS, 'controlsLeft', false)).toBe(true)
    expect(isOverlayShown(OVERLAY_DEFAULTS, 'deviceInfo', false)).toBe(true)
  })

  it('a readout follows its OWN flag', () => {
    const r = readout({ fade: true })
    const c = addReadout(OVERLAY_DEFAULTS, r)
    expect(isOverlayShown(c, `readout:${r.id}`, false)).toBe(false)
    expect(isOverlayShown(c, `readout:${r.id}`, true)).toBe(true)
    const kept = patchReadout(c, r.id, { fade: false })
    expect(isOverlayShown(kept, `readout:${r.id}`, false)).toBe(true)
  })
})

describe('overlay config', () => {
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

  it('a field of THIS camera is a different readout from the same field of device 7', () => {
    const own = readoutId({ kind: 'cameraField', sectionId: 's', fieldKey: 'temp' })
    const other = readoutId({ kind: 'deviceField', deviceId: 7, sectionId: 's', fieldKey: 'temp' })
    expect(own).not.toBe(other)
  })
})

describe('the global config read (parseOverlayConfig)', () => {
  it('anything that is not an object is the defaults, never a throw', () => {
    expect(parseOverlayConfig(null)).toBe(OVERLAY_DEFAULTS)
    expect(parseOverlayConfig('nope')).toBe(OVERLAY_DEFAULTS)
    expect(parseOverlayConfig(undefined)).toBe(OVERLAY_DEFAULTS)
  })

  it('an empty object reads as the defaults', () => {
    expect(isDefaultOverlay(parseOverlayConfig({}))).toBe(true)
  })

  it('drops a single broken readout and keeps the rest of the overlay', () => {
    const raw = {
      layers: ['motion'],
      audioMeter: 'bottom-left',
      readouts: [
        { id: 'x', source: { kind: 'deviceField', deviceId: 'not-a-number' }, label: 'Broken' },
        { id: 'y', source: { kind: 'cameraField', sectionId: 's', fieldKey: 'f' }, label: 'Audio', corner: 'top-left' },
      ],
    }
    const config = parseOverlayConfig(raw)
    expect([...config.layers]).toEqual(['motion'])
    expect(config.audioMeter).toBe('bottom-left')
    expect(config.readouts).toHaveLength(1)
    expect(config.readouts[0]?.label).toBe('Audio')
  })

  it('rejects an unknown position instead of persisting it', () => {
    expect(parseOverlayConfig({ audioMeter: 'middle-of-nowhere' }).audioMeter).toBe(OVERLAY_DEFAULTS.audioMeter)
    expect(parseOverlayConfig({ cameraName: 'somewhere' }).cameraName).toBe('top-left')
    expect(parseOverlayConfig({ viewers: true }).viewers).toBe('off')
  })

  it('a control group never reads as off, and keeps a chosen anchor', () => {
    expect(parseOverlayConfig({ controlsLeft: 'off' }).controlsLeft).toBe('bottom-left')
    expect(parseOverlayConfig({ controlsRight: 'top-right' }).controlsRight).toBe('top-right')
  })

  it('the name can be switched off', () => {
    expect(parseOverlayConfig({ cameraName: 'off' }).cameraName).toBe('off')
  })

  it('fade is read flag by flag; a missing or junk flag is its default', () => {
    const c = parseOverlayConfig({ fade: { stats: true, cameraName: 'yes' } })
    expect(c.fade.stats).toBe(true)
    expect(c.fade.cameraName).toBe(true)
    expect(c.fade.viewers).toBe(false)
  })

  it('order keeps known ids once and drops the rest', () => {
    const c = parseOverlayConfig({ order: ['stats', 'bogus', 'stats', 'occupancy', 7] })
    expect([...c.order]).toEqual(['stats', 'occupancy'])
  })

  it('a document written by the per-camera model reads as defaults for what it lacks', () => {
    // No migration beyond defaults: the retired fields are simply not read.
    const c = parseOverlayConfig({ boxes: 'all', stats: true })
    expect(c.stats).toBe('off')
    expect([...c.layers]).toEqual([])
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

describe('every overlay of the document has a consumer', () => {
  it('the layer draws each placed overlay; the screen hands it the document', () => {
    const layer = readFileSync(join(process.cwd(), 'src', 'components', 'camera', 'overlay', 'OverlayLayer.tsx'), 'utf8')
    const screen = readFileSync(join(process.cwd(), 'src', 'screens', 'CameraDetailScreen.tsx'), 'utf8')
    for (const node of ['<AudioLevelMeter', '<OccupancyBadge', '<StreamStatsOverlay', '<LiveViewersBadge', '<DoorbellBadge']) {
      expect(layer, node).toContain(node)
    }
    expect(screen).toContain('config: overlay')
  })

  it('the motion pill is not mounted — the overlay is the motion treatment', () => {
    const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8')
    expect(read('src', 'screens', 'CameraDetailScreen.tsx')).not.toContain('<MotionBadge')
    expect(read('src', 'components', 'CameraCard.tsx')).not.toContain('<MotionBadge')
    expect(read('src', 'components', 'grid', 'GridTile.tsx')).not.toContain('<MotionBadge')
    expect(read('embed', 'src', 'components', 'GridTilePlayer.tsx')).not.toContain('<TileMotionBadge')
  })

  it('the readouts and the badges use the stack, not a private placement map', () => {
    const readouts = readFileSync(
      join(process.cwd(), 'src', 'components', 'camera', 'overlay', 'OverlayReadouts.tsx'),
      'utf8',
    )
    expect(readouts).not.toContain('CORNER_STYLE')
    expect(readouts).not.toContain('ANCHOR_PLACEMENT')
  })
})

describe('the doorbell badge is an opt-in overlay', () => {
  const live = { hasDoorbell: true, overlaysVisible: true }

  it('is off by default, so the default config draws no badge', () => {
    expect(OVERLAY_DEFAULTS.doorbell).toBe(false)
    expect(doorbellBadgeEnabled({ ...live, switchedOn: OVERLAY_DEFAULTS.doorbell })).toBe(false)
  })

  it('a document stored before the field existed reads as off', () => {
    const stored = parseOverlayConfig({ audioMeter: 'top-center', occupancy: 'off' })
    expect(stored.doorbell).toBe(false)
  })

  it('draws on a doorbell camera once switched on, and persists', () => {
    const on = patchOverlay(OVERLAY_DEFAULTS, { doorbell: true })
    expect(isDefaultOverlay(on)).toBe(false)
    expect(parseOverlayConfig(on).doorbell).toBe(true)
    expect(doorbellBadgeEnabled({ ...live, switchedOn: on.doorbell })).toBe(true)
  })

  it('never draws on a camera without a doorbell, or while overlays are hidden', () => {
    expect(doorbellBadgeEnabled({ hasDoorbell: false, switchedOn: true, overlaysVisible: true })).toBe(false)
    expect(doorbellBadgeEnabled({ hasDoorbell: true, switchedOn: true, overlaysVisible: false })).toBe(false)
  })
})

describe('readout scope', () => {
  const field = (deviceId: number, scope?: number): OverlayReadout => {
    const source = { kind: 'deviceField', deviceId, sectionId: 's', fieldKey: 'k' } as const
    return { id: readoutId(source), source, label: 'T', corner: 'top-right', ...(scope === undefined ? {} : { scope }) }
  }

  it('a device field pinned on one camera shows only there; unscoped readouts show everywhere', () => {
    const pinned = field(9, 1)
    const audio = readout()
    expect(readoutsForCamera([pinned, audio], 1)).toEqual([pinned, audio])
    expect(readoutsForCamera([pinned, audio], 2)).toEqual([audio])
  })

  it('the scope survives a parse, and a cameraField never carries one', () => {
    const parsed = parseOverlayConfig({ readouts: [field(9, 4)] })
    expect(parsed.readouts[0]?.scope).toBe(4)
    const cam = { id: 'c', source: { kind: 'cameraField', sectionId: 's', fieldKey: 'k' }, label: 'x', corner: 'top-left', scope: 4 }
    expect(parseOverlayConfig({ readouts: [cam] }).readouts[0]?.scope).toBeUndefined()
  })
})
