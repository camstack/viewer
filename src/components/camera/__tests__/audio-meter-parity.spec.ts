/**
 * Grid tile, single player and hosted embed must draw THE SAME meter.
 *
 * Native surfaces already mount `AudioLevelMeter`. The embed cannot import RN
 * components, so it reimplements the pill in DOM — but the geometry (orientation
 * at each anchor, bar sizes, render order) is one function, and a second copy
 * that drifted is how the VU looked different on the wall vs the player.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  meterOrientation,
  meterRenderOrder,
  meterSegmentSize,
  DEFAULT_AUDIO_METER_POSITION,
} from '../audio-level.js'
import { OVERLAY_ANCHORS } from '../overlay/overlay-position.js'
import {
  meterOrientation as embedOrientation,
  meterRenderOrder as embedRenderOrder,
  meterSegmentSize as embedSegmentSize,
} from '../../../../embed/src/embed/tile-overlays.js'

const SRC = join(process.cwd(), 'src')

describe('one meter, three hosts', () => {
  it('native grid tile and single player both mount AudioLevelMeter', () => {
    const tile = readFileSync(join(SRC, 'components', 'grid', 'GridTile.tsx'), 'utf8')
    const screen = readFileSync(join(SRC, 'screens', 'CameraDetailScreen.tsx'), 'utf8')
    expect(tile).toContain('<AudioLevelMeter')
    expect(screen).toContain('<AudioLevelMeter')
    expect(tile).not.toContain('TileAudioMeter')
  })

  it('the embed pill uses the shared orientation, not a always-compact stack', () => {
    const embed = readFileSync(
      join(process.cwd(), 'embed', 'src', 'components', 'TileIndicators.tsx'),
      'utf8',
    )
    expect(embed).toContain('meterOrientation(')
    expect(embed).toContain('meterSegmentSize(')
    expect(embed).toContain('meterRenderOrder(')
  })

  it('embed geometry matches the player at every anchor', () => {
    for (const position of [...OVERLAY_ANCHORS, DEFAULT_AUDIO_METER_POSITION] as const) {
      const orientation = meterOrientation(position)
      expect(embedOrientation(position)).toBe(orientation)
      if (orientation === null) continue
      expect([...embedRenderOrder(orientation)]).toEqual([...meterRenderOrder(orientation)])
      for (let i = 0; i < 6; i++) {
        expect(embedSegmentSize(orientation, i)).toEqual(meterSegmentSize(orientation, i))
      }
    }
  })
})
