import { describe, expect, it } from 'vitest'

import {
  classifyPresence,
  decideBackgroundSuspend,
  decideForegroundAction,
} from '../background-suspend.js'

describe('classifyPresence', () => {
  it('calls only `background` a departure', () => {
    expect(classifyPresence('background')).toBe('background')
  })

  it('treats `active` as the foreground', () => {
    expect(classifyPresence('active')).toBe('foreground')
  })

  it('does NOT treat iOS `inactive` as a departure', () => {
    // Control Centre, the notification shade, an app-switcher peek and an
    // incoming call all raise `UIApplicationWillResignActive`. Closing the
    // socket there would flicker the connection on every glance.
    expect(classifyPresence('inactive')).toBe('obscured')
  })

  it('does not act on the launch window', () => {
    // `initialAppState` is whatever `UIApplication.applicationState` was at
    // bridge setup — `unknown` until `applicationDidBecomeActive:`.
    expect(classifyPresence('unknown')).toBe('obscured')
    expect(classifyPresence('extension')).toBe('obscured')
  })
})

describe('decideBackgroundSuspend', () => {
  it('closes the socket when the app leaves and one is open', () => {
    expect(
      decideBackgroundSuspend({ suspended: false, hasTransport: true, hasSocket: true }),
    ).toBe('suspend')
  })

  it('is idempotent — a second departure closes nothing twice', () => {
    expect(
      decideBackgroundSuspend({ suspended: true, hasTransport: true, hasSocket: true }),
    ).toBe('already-suspended')
  })

  it('names the absence of a transport instead of doing nothing quietly', () => {
    expect(
      decideBackgroundSuspend({ suspended: false, hasTransport: false, hasSocket: false }),
    ).toBe('no-transport')
  })

  it('leaves an HTTP transport alone — there is no queue to feed', () => {
    expect(
      decideBackgroundSuspend({ suspended: false, hasTransport: true, hasSocket: false }),
    ).toBe('no-socket')
  })
})

describe('decideForegroundAction', () => {
  it('reopens what WE closed', () => {
    expect(decideForegroundAction(true)).toBe('resume')
  })

  it('otherwise asks whether the socket survived, as before', () => {
    expect(decideForegroundAction(false)).toBe('probe')
  })
})
