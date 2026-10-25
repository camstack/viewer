import { describe, it, expect } from 'vitest'
import { buildTileOverlayMap, tileOverlayFor } from '../embed-config.js'
import {
  OVERLAY_DEFAULTS,
  type CameraOverlayConfig,
} from '../../components/camera/overlay/overlay-config.js'

/**
 * The per-device channel the grid protocol grew so the hosted wall could paint
 * what the per-cell menu offers.
 *
 * The failure it exists to prevent is the one the operator reported: the menu
 * offered the audio meter, the occupancy chips and the stream stats per camera,
 * nothing on the wall drew them, and the first fix HID the rows instead of
 * sending them. Every camera that placed an indicator must appear in this map —
 * and, just as importantly, every camera that placed none must not, because the
 * map is re-pushed across the WebView bridge whenever any camera's prefs change.
 */
function overlay(patch: Partial<CameraOverlayConfig>): CameraOverlayConfig {
  return { ...OVERLAY_DEFAULTS, ...patch }
}

describe('tileOverlayFor', () => {
  it('says nothing for a camera that placed nothing', () => {
    // The factory default places the audio meter, so "nothing" has to turn
    // that off too — this is the all-off camera.
    const bare = overlay({ audioMeter: 'off' })
    expect(tileOverlayFor(bare)).toBeNull()
  })

  it('carries only the members the camera actually placed', () => {
    const config = tileOverlayFor(
      overlay({ motionBadge: 'off', occupancy: 'off', audioMeter: 'bottom-right' }),
    )
    expect(config).toEqual({ audioMeter: 'bottom-right' })
  })

  it('carries every indicator the tile can draw', () => {
    const config = tileOverlayFor(
      overlay({
        layers: ['motion'],
        motionBadge: 'top-right',
        audioMeter: 'bottom-right',
        occupancy: 'bottom-left',
        stats: 'top-left',
      }),
    )
    expect(config).toEqual({
      motionBoxes: true,
      motionBadge: 'top-right',
      audioMeter: 'bottom-right',
      occupancy: 'bottom-left',
      // `stats` keeps its boolean so a page built before `statsAt` still draws.
      stats: true,
      statsAt: 'top-left',
    })
  })

  it('never carries the rows the GRID BAR owns', () => {
    // The DETECTOR layers and the highlight border are wall-wide and already
    // travel in `showBoxes` / `highlight`. A second copy here would be the
    // two-documents bug in a new place. Only `motion` — the one layer the tile
    // paints per camera — may cross.
    const config = tileOverlayFor(
      overlay({
        layers: ['objects', 'discarded', 'stationary'],
        highlightBorder: true,
        occupancy: 'bottom-left',
        motionBadge: 'off',
        audioMeter: 'off',
      }),
    )
    expect(config).toEqual({ occupancy: 'bottom-left' })
  })
})

describe('buildTileOverlayMap', () => {
  it('keys by device id as a STRING — a JSON object has no number keys', () => {
    const map = buildTileOverlayMap([
      { deviceId: 102, overlay: overlay({ audioMeter: 'off', stats: 'bottom-right' }) },
    ])
    expect(map).toEqual({ '102': { stats: true, statsAt: 'bottom-right' } })
  })

  it('omits the cameras that placed nothing', () => {
    const map = buildTileOverlayMap([
      { deviceId: 1, overlay: overlay({ audioMeter: 'off' }) },
      { deviceId: 2, overlay: overlay({ motionBadge: 'off', occupancy: 'top-left' }) },
    ])
    expect(Object.keys(map)).toEqual(['2'])
  })

  it('is empty for an empty wall', () => {
    expect(buildTileOverlayMap([])).toEqual({})
  })
})

describe('live viewers and the overlay size travel to the wall', () => {
  it('carries the viewers position beside the other indicators', () => {
    expect(tileOverlayFor(overlay({ audioMeter: 'off', viewers: 'bottom-left' }))).toEqual({
      viewers: 'bottom-left',
    })
  })

  it('says nothing of the size at the default, so an untouched wall sends the bytes it always did', () => {
    expect(tileOverlayFor(overlay({ audioMeter: 'bottom-right' }), 'medium')).toEqual({
      audioMeter: 'bottom-right',
    })
  })

  it('carries a non-default size on a camera that draws something', () => {
    expect(tileOverlayFor(overlay({ audioMeter: 'bottom-right' }), 'large')).toEqual({
      audioMeter: 'bottom-right',
      size: 'large',
    })
    expect(tileOverlayFor(overlay({ audioMeter: 'off', viewers: 'top-left' }), 'small')).toEqual({
      viewers: 'top-left',
      size: 'small',
    })
  })

  it('never makes an entry for a camera that drew nothing, whatever the size', () => {
    expect(tileOverlayFor(overlay({ audioMeter: 'off' }), 'large')).toBeNull()
  })

  it('the map applies the one device size to every entry', () => {
    const map = buildTileOverlayMap(
      [
        { deviceId: 1, overlay: overlay({ audioMeter: 'top-left' }) },
        { deviceId: 2, overlay: overlay({ audioMeter: 'off' }) },
        { deviceId: 3, overlay: overlay({ audioMeter: 'off', viewers: 'bottom-right' }) },
      ],
      'large',
    )
    expect(map).toEqual({
      '1': { audioMeter: 'top-left', size: 'large' },
      '3': { viewers: 'bottom-right', size: 'large' },
    })
  })
})

