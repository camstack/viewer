import { describe, it, expect, beforeEach } from 'vitest'

import {
  stashPendingDeepLink,
  takePendingDeepLink,
  isStashableDeepLink,
  _resetPendingDeepLink,
} from '../pending-deep-link.js'

describe('pending deep link', () => {
  beforeEach(() => _resetPendingDeepLink())

  it('a deep link survives the auth redirect and is consumed ONCE', () => {
    // The (app) guard used to do a bare Redirect href="/" — the URL a
    // notification tap was opening died there, and the operator landed on the
    // camera list concluding the link was broken (§3.4.1 of the click-actions
    // design — the single most important viewer-side gap).
    stashPendingDeepLink('/camera/101?at=1787067304462')
    expect(takePendingDeepLink()).toBe('/camera/101?at=1787067304462')
    expect(takePendingDeepLink()).toBeNull()
  })

  it('only real destinations are stashable — defaults and auth are not', () => {
    expect(isStashableDeepLink('/camera/101?at=1')).toBe(true)
    expect(isStashableDeepLink('/events?trackId=x')).toBe(true)
    expect(isStashableDeepLink('/grid/2')).toBe(true)
    expect(isStashableDeepLink('/notifications')).toBe(true)
    expect(isStashableDeepLink('/')).toBe(false)
    expect(isStashableDeepLink('/cameras')).toBe(false)
    expect(isStashableDeepLink('/auth-callback?code=x')).toBe(false)
  })

  it('stashing a non-destination is a no-op', () => {
    stashPendingDeepLink('/cameras')
    expect(takePendingDeepLink()).toBeNull()
  })
})
