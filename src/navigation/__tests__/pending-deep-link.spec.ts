import { describe, it, expect, beforeEach } from 'vitest'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

describe('a cold link to a tab or a settings page is not dropped (#708)', () => {
  beforeEach(() => _resetPendingDeepLink())

  it('keeps /grids and /settings/*, which the allow-list used to refuse', () => {
    for (const href of ['/grids', '/settings', '/settings/cameras', '/settings/sign-in?x=1']) {
      expect(isStashableDeepLink(href), href).toBe(true)
    }
    stashPendingDeepLink('/settings/cameras')
    expect(takePendingDeepLink()).toBe('/settings/cameras')
  })

  it('does not treat a longer first segment as the same family', () => {
    expect(isStashableDeepLink('/gridsfoo')).toBe(false)
    expect(isStashableDeepLink('/settingsx/y')).toBe(false)
  })

  it('every route family the (app) group serves is a destination, so a new route cannot be dropped silently', () => {
    const appGroup = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'app', '(app)')
    const families = readdirSync(appGroup, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('_') && !e.name.startsWith('('))
      .map((e) => (e.isDirectory() ? e.name : e.name.replace(/\.tsx$/, '')))
    const tabs = readdirSync(path.join(appGroup, '(tabs)')).filter((n) => !n.startsWith('_')).map((n) => n.replace(/\.tsx$/, ''))
    // `/cameras` is the default landing: resuming it is a no-op, not a link.
    const all = [...families, ...tabs.filter((t) => t !== 'cameras')]
    expect(all.length).toBeGreaterThan(10)
    for (const family of all) {
      expect(isStashableDeepLink(`/${family}`), family).toBe(true)
      expect(isStashableDeepLink(`/${family}/x?y=1`), family).toBe(true)
    }
  })
})
