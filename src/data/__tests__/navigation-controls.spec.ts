import { describe, expect, it } from 'vitest'
import {
  actionEntry,
  enabledEntries,
  NAVIGATION_VECTORS,
  parseNavigationEntries,
  parseNavigationFeatures,
  parseNavigationStatus,
  stepLightLevel,
} from '../navigation-controls.js'

describe('navigation controls — the pure half', () => {
  it('the drive vocabulary maps to the cap axes: forward = tilt up, turn-around = tilt down', () => {
    expect(NAVIGATION_VECTORS.forward).toEqual({ pan: 0, tilt: 1 })
    expect(NAVIGATION_VECTORS.turnAround).toEqual({ pan: 0, tilt: -1 })
    expect(NAVIGATION_VECTORS.left.pan).toBe(-1)
    expect(NAVIGATION_VECTORS.right.pan).toBe(1)
  })

  it('parses listActions rows and drops a malformed one instead of guessing', () => {
    const entries = parseNavigationEntries([
      { id: 'goHome', kind: 'action', label: 'Return to dock', icon: 'home', enabled: true },
      { id: 'sound:meow', kind: 'sound', label: 'Meow', icon: 'cat', soundId: 684, enabled: true },
      { id: 'dockWash', kind: 'action', label: 'Wash mop', icon: 'droplets', enabled: false },
      { id: 'broken', kind: 'dance', label: 'x', icon: 'y', enabled: true },
    ])
    expect(entries).toHaveLength(3)
    expect(enabledEntries(entries, 'action').map((e) => e.id)).toEqual(['goHome'])
    expect(enabledEntries(entries, 'sound')[0]?.soundId).toBe(684)
    expect(actionEntry(entries, 'goHome')?.label).toBe('Return to dock')
    // Disabled rows and sounds are not actions the overlay may draw.
    expect(actionEntry(entries, 'dockWash')).toBeUndefined()
    expect(actionEntry(entries, 'sound:meow')).toBeUndefined()
  })

  it('features and status are read defensively — an absent flag is off, an absent level is full', () => {
    expect(parseNavigationFeatures({ move: true, light: true })).toMatchObject({
      move: true,
      light: true,
      goToPoint: false,
      playSound: false,
    })
    expect(parseNavigationStatus({ mode: 'following', following: true, lightMode: 'manual', lightLevel: 60 })).toEqual({
      mode: 'following',
      following: true,
      flash: false,
      lightMode: 'manual',
      lightLevel: 60,
    })
    expect(parseNavigationStatus({})).toMatchObject({ mode: 'unknown', lightMode: 'auto', lightLevel: 100 })
    expect(parseNavigationFeatures(null)).toBeNull()
  })

  it('the level stepper stays inside the cap bounds', () => {
    expect(stepLightLevel(100, 1)).toBe(100)
    expect(stepLightLevel(45, -1)).toBe(40)
    expect(stepLightLevel(60, 1)).toBe(70)
  })
})
