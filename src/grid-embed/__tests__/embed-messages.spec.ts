import { describe, it, expect } from 'vitest'
import { parseGridHostMessage, gridCommandScript, coerceGridHostMessage } from '../embed-messages.js'

const rect = { x: 1, y: 2, w: 3, h: 4 }

describe('parseGridHostMessage', () => {
  it('parses a state message', () => {
    expect(parseGridHostMessage(JSON.stringify({ type: 'state', state: 'ready' }))).toEqual({
      type: 'state',
      state: 'ready',
    })
  })

  it('parses a state message with a detail message', () => {
    expect(parseGridHostMessage(JSON.stringify({ type: 'state', state: 'error', message: 'boom' }))).toEqual({
      type: 'state',
      state: 'error',
      message: 'boom',
    })
  })

  it('parses tileTap / tileLongPress with a rect', () => {
    expect(parseGridHostMessage(JSON.stringify({ type: 'tileTap', deviceId: 7, rect }))).toEqual({
      type: 'tileTap',
      deviceId: 7,
      rect,
    })
    expect(parseGridHostMessage(JSON.stringify({ type: 'tileLongPress', deviceId: 8, rect }))).toEqual({
      type: 'tileLongPress',
      deviceId: 8,
      rect,
    })
  })

  it('parses a cellPanelOpen for each panel a tile can ask for', () => {
    for (const panel of ['devices', 'viewOptions', 'actions'] as const) {
      expect(parseGridHostMessage(JSON.stringify({ type: 'cellPanelOpen', deviceId: 7, panel }))).toEqual({
        type: 'cellPanelOpen',
        deviceId: 7,
        panel,
      })
    }
  })

  it('rejects a cellPanelOpen for a panel the host does not host', () => {
    // The page is untrusted input: an unknown panel name must not reach the
    // host's panel union (where it would render nothing and look like a dead
    // button instead of a rejected message).
    expect(parseGridHostMessage(JSON.stringify({ type: 'cellPanelOpen', deviceId: 7, panel: 'ptz' }))).toBeNull()
    expect(parseGridHostMessage(JSON.stringify({ type: 'cellPanelOpen', deviceId: 7 }))).toBeNull()
    expect(
      parseGridHostMessage(JSON.stringify({ type: 'cellPanelOpen', deviceId: 'x', panel: 'devices' })),
    ).toBeNull()
  })

  it('parses a layout message', () => {
    const msg = { type: 'layout', tiles: [{ deviceId: 7, rect }] }
    expect(parseGridHostMessage(JSON.stringify(msg))).toEqual(msg)
  })

  it('returns null for junk / unknown / malformed', () => {
    expect(parseGridHostMessage('not json')).toBeNull()
    expect(parseGridHostMessage(JSON.stringify({ type: 'nope' }))).toBeNull()
    expect(parseGridHostMessage(JSON.stringify({ type: 'tileTap', deviceId: 'x', rect }))).toBeNull()
    expect(parseGridHostMessage(JSON.stringify({ type: 'state' }))).toBeNull()
  })
})

describe('gridCommandScript', () => {
  it('serializes each grid-wide command to a window.__camstackGrid call', () => {
    expect(gridCommandScript({ kind: 'setMutedAll', value: true })).toContain('window.__camstackGrid')
    expect(gridCommandScript({ kind: 'setMutedAll', value: true })).toContain('setMutedAll(true)')
    expect(gridCommandScript({ kind: 'setPaused', value: [1, 2] })).toContain('setPaused([1,2])')
    expect(gridCommandScript({ kind: 'setQuality', value: 'high' })).toContain('setQuality("high")')
    expect(gridCommandScript({ kind: 'setLayout', value: 3 })).toContain('setLayout(3)')
    expect(gridCommandScript({ kind: 'setLayout', value: 'auto' })).toContain('setLayout("auto")')
    expect(gridCommandScript({ kind: 'setShowName', value: true })).toContain('setShowName(true)')
    expect(gridCommandScript({ kind: 'setShowBoxes', value: true })).toContain('setShowBoxes(true)')
    expect(gridCommandScript({ kind: 'setShowBoxes', value: false })).toContain('setShowBoxes(false)')
    expect(gridCommandScript({ kind: 'fit', w: 800, h: 600 })).toContain('fit(800, 600)')
  })

  it('serializes the argument-less reconnect command', () => {
    const s = gridCommandScript({ kind: 'reconnect' })
    expect(s).toContain('window.__camstackGrid')
    expect(s).toContain('reconnect()')
    expect(s.trim().endsWith('true;')).toBe(true)
  })

  it('guards the call (no throw if the API is not mounted yet) and ends with `true;`', () => {
    const s = gridCommandScript({ kind: 'setPaused', value: [] })
    expect(s).toMatch(/window\.__camstackGrid\s*&&/)
    expect(s.trim().endsWith('true;')).toBe(true)
  })
})

describe('coerceGridHostMessage', () => {
  const rect = { x: 1, y: 2, w: 3, h: 4 }

  it('coerces an object (web postMessage) without JSON.parse', () => {
    expect(coerceGridHostMessage({ type: 'tileOpen', deviceId: 7 })).toEqual({ type: 'tileOpen', deviceId: 7 })
    expect(coerceGridHostMessage({ type: 'state', state: 'ready' })).toEqual({ type: 'state', state: 'ready' })
    expect(coerceGridHostMessage({ type: 'tileTap', deviceId: 7, rect })).toEqual({ type: 'tileTap', deviceId: 7, rect })
  })

  it('returns null for junk objects', () => {
    expect(coerceGridHostMessage({ type: 'nope' })).toBeNull()
    expect(coerceGridHostMessage(null)).toBeNull()
    expect(coerceGridHostMessage('a string')).toBeNull()
  })
})
