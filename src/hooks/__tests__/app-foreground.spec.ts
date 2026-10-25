import { describe, expect, it } from 'vitest'

import {
  APP_STATE_STATUSES,
  isAppForeground,
  type AppForegroundStatus,
} from '../app-foreground.js'

/**
 * The rule is stated as an EXCLUSION on purpose: `background` (and `extension`,
 * where the process is not drawing this app at all) are the only two statuses
 * that mean nobody can see the screen. Written the other way round — "foreground
 * means `active`" — every status the platform adds later, and every status the
 * platform reports before it has settled, silently becomes "hidden".
 *
 * That is not hypothetical. It is both operator reports of 2026-08-18.
 */
describe('isAppForeground', () => {
  it('is true for active', () => {
    expect(isAppForeground('active')).toBe(true)
  })

  it('is true for inactive — the shade, Control Centre and the app switcher', () => {
    // `RCTAppState` maps `UIApplicationWillResignActiveNotification` to
    // `inactive`. None of the three gestures that raise it backgrounds the app,
    // and the operator is still looking at the screen throughout.
    expect(isAppForeground('inactive')).toBe(true)
  })

  it('is true for unknown, and for a state the bridge has not reported yet', () => {
    // `RCTCurrentAppState()` falls back to `"unknown"`, and `AppState.currentState`
    // is initialised to `null` before the native constants are read. A cold
    // launch must not start out treated as hidden — that is what deferred the
    // first snapshot demand until after an AppState CHANGE event.
    expect(isAppForeground('unknown')).toBe(true)
    expect(isAppForeground(null)).toBe(true)
    expect(isAppForeground(undefined)).toBe(true)
  })

  it('is false for background — the one status that means nobody is looking', () => {
    expect(isAppForeground('background')).toBe(false)
  })

  it('is false for extension — this process is not drawing the app', () => {
    expect(isAppForeground('extension')).toBe(false)
  })

  it('classifies every status the platform can report', () => {
    // A status added to the union without a decision here would fall through to
    // the default, so the table is asserted whole rather than sampled.
    const decided = APP_STATE_STATUSES.map(
      (status: AppForegroundStatus) => [status, isAppForeground(status)] as const,
    )
    expect(decided).toEqual([
      ['active', true],
      ['inactive', true],
      ['unknown', true],
      ['background', false],
      ['extension', false],
    ])
  })
})
