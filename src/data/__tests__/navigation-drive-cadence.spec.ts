/**
 * The drive cadence, on its own clock.
 *
 * The cap's `move` is momentary and the provider forwards EVERY one to a drive
 * write without coalescing — so the viewer owns the rate. Both drive surfaces
 * (the d-pad's `startDrive`, the joystick's `driveVector`) go through this one
 * ticker: one nudge now, then one per second carrying the LATEST vector, and a
 * single `stop` on release. A joystick that sent a `move` per gesture frame
 * would flood the robot; one that sent only the first vector would drive it
 * where the finger WAS (operator, 2026-09-06).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NAVIGATION_DRIVE_INTERVAL_MS } from '../navigation-controls.js'
import { createDriveCadence, type DriveVector } from '../navigation-drive-cadence.js'

interface Harness {
  readonly moves: DriveVector[]
  readonly stops: () => number
  readonly cadence: ReturnType<typeof createDriveCadence>
}

function harness(): Harness {
  const moves: DriveVector[] = []
  let stops = 0
  const cadence = createDriveCadence({
    move: (v) => { moves.push(v) },
    stop: () => { stops += 1 },
  })
  return { moves, stops: () => stops, cadence }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('createDriveCadence', () => {
  it('nudges once immediately, then once per interval', () => {
    const h = harness()
    h.cadence.drive({ pan: 0, tilt: 1 })
    expect(h.moves).toEqual([{ pan: 0, tilt: 1 }])
    vi.advanceTimersByTime(NAVIGATION_DRIVE_INTERVAL_MS - 1)
    expect(h.moves).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(h.moves).toHaveLength(2)
    vi.advanceTimersByTime(NAVIGATION_DRIVE_INTERVAL_MS * 2)
    expect(h.moves).toHaveLength(4)
    expect(h.stops()).toBe(0)
  })

  it('a vector updated within the same second is NOT sent until the tick — and the tick sends the latest', () => {
    const h = harness()
    h.cadence.drive({ pan: 0, tilt: 1 })
    h.cadence.drive({ pan: 0.3, tilt: 0.9 })
    h.cadence.drive({ pan: 0.5, tilt: 0.5 })
    expect(h.moves).toHaveLength(1)
    vi.advanceTimersByTime(NAVIGATION_DRIVE_INTERVAL_MS)
    expect(h.moves).toHaveLength(2)
    expect(h.moves[1]).toEqual({ pan: 0.5, tilt: 0.5 })
  })

  it('stop halts the ticker and sends one stop; a stop with nothing driving still sends it (the Stop button)', () => {
    const h = harness()
    h.cadence.drive({ pan: 1, tilt: 0 })
    h.cadence.stop()
    expect(h.stops()).toBe(1)
    expect(h.cadence.active()).toBe(false)
    vi.advanceTimersByTime(NAVIGATION_DRIVE_INTERVAL_MS * 3)
    expect(h.moves).toHaveLength(1)
    h.cadence.stop()
    expect(h.stops()).toBe(2)
  })

  it('a zero vector while driving is a release: stop, no more ticks; while idle it is nothing', () => {
    const h = harness()
    h.cadence.drive({ pan: 0, tilt: 0 })
    expect(h.moves).toHaveLength(0)
    expect(h.stops()).toBe(0)
    h.cadence.drive({ pan: 0, tilt: 1 })
    h.cadence.drive({ pan: 0, tilt: 0 })
    expect(h.stops()).toBe(1)
    vi.advanceTimersByTime(NAVIGATION_DRIVE_INTERVAL_MS * 2)
    expect(h.moves).toHaveLength(1)
  })

  it('driving again after a release starts a fresh cadence: an immediate nudge', () => {
    const h = harness()
    h.cadence.drive({ pan: 0, tilt: 1 })
    h.cadence.stop()
    h.cadence.drive({ pan: -1, tilt: 0 })
    expect(h.moves).toEqual([{ pan: 0, tilt: 1 }, { pan: -1, tilt: 0 }])
  })

  it('dispose sends stop only if a drive was active — never leaves a robot driving because the sheet closed', () => {
    const idle = harness()
    idle.cadence.dispose()
    expect(idle.stops()).toBe(0)
    const busy = harness()
    busy.cadence.drive({ pan: 0, tilt: 1 })
    busy.cadence.dispose()
    expect(busy.stops()).toBe(1)
    vi.advanceTimersByTime(NAVIGATION_DRIVE_INTERVAL_MS * 2)
    expect(busy.moves).toHaveLength(1)
  })
})

describe('useNavigation routes BOTH drive surfaces through the one cadence', () => {
  const HOOK = readFileSync(join(process.cwd(), 'src', 'data', 'use-navigation.ts'), 'utf8')

  it('the hook exposes driveVector next to startDrive, and neither owns a timer of its own', () => {
    expect(HOOK).toContain('readonly driveVector: (pan: number, tilt: number) => void')
    expect(HOOK).toContain('createDriveCadence(')
    expect(HOOK).not.toContain('setInterval(')
  })
})
