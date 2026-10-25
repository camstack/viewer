/**
 * Device-information overlay defaults and placement vocabulary.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULTS, parseDeviceInfoPosition, parseSettings } from '../../../store/settings-store.js'
import { isOverlayPosition } from '../overlay/overlay-position.js'
import {
  GRID_BAR_ROWS,
  GRID_ROW_OWNER,
  isRowVisible,
  ROW_GROUP,
  VIEW_OPTION_ROWS,
} from '../../../grid/view-options-scope.js'

describe('device information overlay setting', () => {
  it('defaults to top-right (on)', () => {
    expect(DEFAULTS.deviceInfo).toBe('off')
    expect(isOverlayPosition(DEFAULTS.deviceInfo)).toBe(true)
  })

  it('is a liveIndicators row owned by the grid bar, visible in single', () => {
    expect(VIEW_OPTION_ROWS).toContain('deviceInfo')
    expect(ROW_GROUP.deviceInfo).toBe('liveIndicators')
    expect(GRID_ROW_OWNER.deviceInfo).toBe('bar')
    expect(GRID_BAR_ROWS).toContain('deviceInfo')
    expect(isRowVisible('deviceInfo', 'single')).toBe(true)
    expect(isRowVisible('deviceInfo', 'grid-cell')).toBe(false)
  })
})

describe('legacy hostBattery key migrates', () => {
  it('reads the 1.0.596-1.0.598 key when the new one is absent', () => {
    expect(parseDeviceInfoPosition({ hostBattery: 'bottom-left' })).toBe('bottom-left')
    expect(parseDeviceInfoPosition({ hostBattery: 'off' })).toBe('off')
  })
  it('prefers the new key, and falls back to the default on junk', () => {
    expect(parseDeviceInfoPosition({ deviceInfo: 'top-left', hostBattery: 'off' })).toBe('top-left')
    expect(parseDeviceInfoPosition({ hostBattery: 'sideways' })).toBe(DEFAULTS.deviceInfo)
    expect(parseDeviceInfoPosition({})).toBe(DEFAULTS.deviceInfo)
  })
  it('parseSettings carries a persisted legacy document over', () => {
    expect(parseSettings(JSON.stringify({ hostBattery: 'bottom-right' })).deviceInfo).toBe('bottom-right')
    expect(parseSettings(JSON.stringify({ hostBattery: 'off' })).deviceInfo).toBe('off')
  })
})
