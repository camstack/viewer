/**
 * The event-emitter row's two decisions, asserted without a renderer.
 *
 * The discriminating one is the last block: a NEW press must move the row, and
 * the ONLY field that separates two identical presses of the same button is
 * `seq`. Key the highlight on `eventType` or `timestamp` and the second press
 * disappears — which on an input-only device is indistinguishable from a dead
 * radio.
 */
import { describe, it, expect } from 'vitest'
import {
  channelIndexOf,
  clearFlash,
  composeEventLabel,
  formatEventAgo,
  nextFlashState,
  IDLE_FLASH,
} from '../event-emitter-logic.js'

describe('channelIndexOf', () => {
  it('reads an integer button index', () => {
    expect(channelIndexOf({ channel: 1 })).toBe(1)
    expect(channelIndexOf({ channel: 0 })).toBe(0)
  })

  it('returns null when the device reports no channel', () => {
    // Single-button emitters and generic bus events land here; the row must
    // still render, showing the event type alone.
    expect(channelIndexOf({})).toBeNull()
    expect(channelIndexOf(null)).toBeNull()
    expect(channelIndexOf(undefined)).toBeNull()
  })

  it('rejects an implausible index rather than rendering it', () => {
    expect(channelIndexOf({ channel: '1' })).toBeNull()
    expect(channelIndexOf({ channel: 2.5 })).toBeNull()
    expect(channelIndexOf({ channel: -3 })).toBeNull()
  })
})

describe('formatEventAgo', () => {
  const now = 1_700_000_000_000
  it('is second-granular for the window an operator is watching', () => {
    expect(formatEventAgo(now, now)).toBe('now')
    expect(formatEventAgo(now - 3_000, now)).toBe('3s')
    expect(formatEventAgo(now - 59_000, now)).toBe('59s')
  })
  it('rolls up to minutes / hours / days', () => {
    expect(formatEventAgo(now - 120_000, now)).toBe('2m')
    expect(formatEventAgo(now - 5 * 3_600_000, now)).toBe('5h')
    expect(formatEventAgo(now - 2 * 86_400_000, now)).toBe('2d')
  })
  it('never renders a negative age on clock skew', () => {
    expect(formatEventAgo(now + 10_000, now)).toBe('now')
  })
})

describe('composeEventLabel', () => {
  it('names the button when there is one', () => {
    expect(composeEventLabel('Button 1', 'PRESS_SHORT', '3s')).toBe('Button 1 · PRESS_SHORT · 3s')
  })
  it('drops the button segment when the device reports none', () => {
    expect(composeEventLabel(null, 'press_short', '5m')).toBe('press_short · 5m')
  })
})

describe('nextFlashState — the discriminating behaviour', () => {
  it('does not flash on the first seq it ever sees', () => {
    // Opening the panel on an hours-old press must not claim it just happened.
    expect(nextFlashState(IDLE_FLASH, 7)).toEqual({ seq: 7, flashing: false })
  })

  it('does not flash when the SAME seq is re-delivered', () => {
    // A reconcile refetch re-runs the guard with an unchanged payload.
    const seeded = { seq: 7, flashing: false }
    expect(nextFlashState(seeded, 7)).toBe(seeded)
  })

  it('FLASHES when a new press advances seq', () => {
    expect(nextFlashState({ seq: 7, flashing: false }, 8)).toEqual({ seq: 8, flashing: true })
  })

  it('flashes again for a second identical press — only seq separates them', () => {
    // Same button, same event type, same wall-clock second: `seq` is the only
    // difference, and the row must still light up.
    const after = nextFlashState({ seq: 8, flashing: false }, 9)
    expect(after).toEqual({ seq: 9, flashing: true })
  })

  it('goes idle when the device has no event at all', () => {
    expect(nextFlashState({ seq: 3, flashing: true }, null)).toEqual(IDLE_FLASH)
    expect(nextFlashState(IDLE_FLASH, null)).toBe(IDLE_FLASH)
  })
})

describe('clearFlash', () => {
  it('extinguishes a lit highlight but keeps the seq', () => {
    expect(clearFlash({ seq: 8, flashing: true })).toEqual({ seq: 8, flashing: false })
  })
  it('is identity-stable when nothing is lit', () => {
    const idle = { seq: 8, flashing: false }
    expect(clearFlash(idle)).toBe(idle)
  })
})
