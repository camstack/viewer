import { describe, it, expect } from 'vitest'
import {
  dbfsToLevel,
  meterOrientation,
  AUDIO_LEVEL_STEPS,
  AUDIO_METER_FLOOR_DBFS,
  AUDIO_METER_CEILING_DBFS,
  AUDIO_LEVEL_THRESHOLDS_DBFS,
  AUDIO_LEVEL_COLORS,
  AUDIO_HIGHLIGHT_HOLD_SEC,
  AUDIO_HIGHLIGHT_LEVELS,
  audioLevelColor,
  dbfsForAudioUi,
  audioUiFromStored,
  anchorBands,
  DEFAULT_AUDIO_METER_POSITION,
  meterSegmentSize,
  meterRenderOrder,
} from '../audio-level.js'
import { OVERLAY_ANCHORS } from '../overlay/overlay-position.js'

describe('dbfsToLevel — 6-step VU mapping', () => {
  it('has six rungs from floor to ceiling', () => {
    expect(AUDIO_LEVEL_STEPS).toBe(6)
    expect(AUDIO_LEVEL_THRESHOLDS_DBFS).toHaveLength(6)
    expect(AUDIO_LEVEL_THRESHOLDS_DBFS[0]).toBe(AUDIO_METER_FLOOR_DBFS)
    expect(AUDIO_LEVEL_THRESHOLDS_DBFS[5]).toBe(AUDIO_METER_CEILING_DBFS)
  })

  it('silence / no reading / below floor → 0 lit segments', () => {
    expect(dbfsToLevel(null)).toBe(0)
    expect(dbfsToLevel(Number.NEGATIVE_INFINITY)).toBe(0)
    expect(dbfsToLevel(Number.NaN)).toBe(0)
    expect(dbfsToLevel(-96)).toBe(0)
    expect(dbfsToLevel(-61)).toBe(0)
  })

  it('climbs one rung per threshold, saturates at 6', () => {
    expect(dbfsToLevel(-60)).toBe(1)
    expect(dbfsToLevel(-53)).toBe(2)
    expect(dbfsToLevel(-46)).toBe(3)
    expect(dbfsToLevel(-39)).toBe(4)
    expect(dbfsToLevel(-32)).toBe(5)
    expect(dbfsToLevel(-24)).toBe(6)
    expect(dbfsToLevel(0)).toBe(AUDIO_LEVEL_STEPS)
    expect(dbfsToLevel(5)).toBe(6)
  })

  it('a value just below a floor stays on the lower step', () => {
    expect(dbfsToLevel(-60.1)).toBe(0)
    expect(dbfsToLevel(-53.1)).toBe(1)
  })
})

describe('audio badge color grows across the six levels', () => {
  it('has one color per rung, all distinct, quiet green → loud red', () => {
    expect(AUDIO_LEVEL_COLORS).toHaveLength(6)
    expect(new Set(AUDIO_LEVEL_COLORS).size).toBe(6)
    expect(AUDIO_LEVEL_COLORS[0]).toBe('#22c55e')
    expect(AUDIO_LEVEL_COLORS[5]).toBe('#ef4444')
  })

  it('audioLevelColor is the rung itself, not a 3-band collapse', () => {
    for (let i = 0; i < 6; i++) {
      expect(audioLevelColor(i)).toBe(AUDIO_LEVEL_COLORS[i])
    }
  })
})

describe('highlight presets are meter rungs 2, 4 and 6', () => {
  it('hold is always 5 seconds', () => {
    expect(AUDIO_HIGHLIGHT_HOLD_SEC).toBe(5)
    expect([...AUDIO_HIGHLIGHT_LEVELS]).toEqual([2, 4, 6])
  })

  it('low / mid / high map to those rungs\' dBFS floors', () => {
    expect(dbfsForAudioUi('low')).toBe(AUDIO_LEVEL_THRESHOLDS_DBFS[1])
    expect(dbfsForAudioUi('mid')).toBe(AUDIO_LEVEL_THRESHOLDS_DBFS[3])
    expect(dbfsForAudioUi('high')).toBe(AUDIO_LEVEL_THRESHOLDS_DBFS[5])
  })

  it('stored off stays off; sensor (retired) becomes low; level snaps to nearest preset', () => {
    expect(audioUiFromStored('off', -30)).toBe('off')
    expect(audioUiFromStored('sensor', -30)).toBe('low')
    expect(audioUiFromStored('level', dbfsForAudioUi('low'))).toBe('low')
    expect(audioUiFromStored('level', dbfsForAudioUi('mid'))).toBe('mid')
    expect(audioUiFromStored('level', dbfsForAudioUi('high'))).toBe('high')
    expect(audioUiFromStored('level', -50)).toBe('low')
    expect(audioUiFromStored('level', -20)).toBe('high')
  })
})

describe('anchorBands — meter position → placement bands', () => {
  it('off → null (nothing to place)', () => {
    expect(anchorBands('off')).toBeNull()
  })

  it('offers exactly the eight non-centre anchors', () => {
    expect(OVERLAY_ANCHORS).toHaveLength(8)
    expect(OVERLAY_ANCHORS).not.toContain('off')
  })

  it('decomposes each anchor into vertical + horizontal bands', () => {
    expect(anchorBands('top-left')).toEqual({ vertical: 'top', horizontal: 'left' })
    expect(anchorBands('top-center')).toEqual({ vertical: 'top', horizontal: 'center' })
    expect(anchorBands('top-right')).toEqual({ vertical: 'top', horizontal: 'right' })
    expect(anchorBands('left-center')).toEqual({ vertical: 'center', horizontal: 'left' })
    expect(anchorBands('right-center')).toEqual({ vertical: 'center', horizontal: 'right' })
    expect(anchorBands('bottom-left')).toEqual({ vertical: 'bottom', horizontal: 'left' })
    expect(anchorBands('bottom-center')).toEqual({ vertical: 'bottom', horizontal: 'center' })
    expect(anchorBands('bottom-right')).toEqual({ vertical: 'bottom', horizontal: 'right' })
  })

  it('every offered position decomposes to a non-null band pair', () => {
    for (const p of OVERLAY_ANCHORS) {
      expect(anchorBands(p)).not.toBeNull()
    }
  })
})

describe('meterOrientation — anchor → adaptive layout', () => {
  it('off → null (nothing to lay out)', () => {
    expect(meterOrientation('off')).toBeNull()
  })

  it('top/bottom edge midpoints → horizontal strip', () => {
    expect(meterOrientation('top-center')).toBe('horizontal')
    expect(meterOrientation('bottom-center')).toBe('horizontal')
  })

  it('left/right side midpoints → vertical strip', () => {
    expect(meterOrientation('left-center')).toBe('vertical')
    expect(meterOrientation('right-center')).toBe('vertical')
  })

  it('corners → compact pill', () => {
    expect(meterOrientation('top-left')).toBe('compact')
    expect(meterOrientation('top-right')).toBe('compact')
    expect(meterOrientation('bottom-left')).toBe('compact')
    expect(meterOrientation('bottom-right')).toBe('compact')
  })

  it('every offered position resolves to a non-null orientation', () => {
    for (const p of OVERLAY_ANCHORS) {
      expect(meterOrientation(p)).not.toBeNull()
    }
  })
})

describe('DEFAULT_AUDIO_METER_POSITION', () => {
  it('a fresh enable lands top-center — same place the default overlay puts it', () => {
    expect(DEFAULT_AUDIO_METER_POSITION).toBe('top-center')
    expect(meterOrientation(DEFAULT_AUDIO_METER_POSITION)).toBe('horizontal')
  })
})

describe('meter segment geometry', () => {
  it('top-center is a horizontal strip of equal bars, not a compact corner pill', () => {
    expect(meterSegmentSize('horizontal', 0)).toEqual({ width: 8, height: 16 })
    expect(meterSegmentSize('horizontal', 5)).toEqual({ width: 8, height: 16 })
    expect(meterRenderOrder('horizontal')).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('a side-centre is a vertical strip that lights bottom → top', () => {
    expect(meterSegmentSize('vertical', 0)).toEqual({ width: 24, height: 7 })
    expect(meterRenderOrder('vertical')).toEqual([5, 4, 3, 2, 1, 0])
  })

  it('a corner is the compact pill — bars grow in height', () => {
    expect(meterSegmentSize('compact', 0).height).toBeLessThan(meterSegmentSize('compact', 5).height)
    expect(meterRenderOrder('compact')).toEqual([0, 1, 2, 3, 4, 5])
  })
})
