import { describe, expect, it } from 'vitest'

import { parseAppInfos, type AppCatalog } from '../app-catalog.js'
import { launchResolvable, offeredLaunchPreferences, parseAppId, parseLaunchPreference, resolveApp, resolveLaunchApp, resolveSwitchApp, switchResolvable } from '../app-launch.js'

function app(id: string, entry: Record<string, unknown>, order: number): Record<string, unknown> {
  return {
    addonId: `addon-${id}`,
    app: {
      id,
      label: { key: `apps.${id}`, fallback: id },
      icon: 'monitor',
      order,
      entry,
      reach: { kind: 'hub' },
      adminOnly: false,
      nav: [],
      takesSharedSearch: false,
      settings: null,
    },
  }
}

const answered: AppCatalog = {
  status: 'answered',
  apps: parseAppInfos([
    app('shell', { kind: 'native', route: '/cameras' }, 10),
    app('other', { kind: 'web', path: '/', auth: 'handoff' }, 20),
  ]) ?? [],
}
const PENDING: AppCatalog = { status: 'pending' }
const UNKNOWN: AppCatalog = { status: 'unknown' }

describe('parsing what the device remembered', () => {
  it('an app id is any non-empty string; anything else is the shell itself', () => {
    expect(parseAppId('x')).toBe('x')
    expect(parseAppId('')).toBeNull()
    expect(parseAppId(3)).toBeNull()
    expect(parseLaunchPreference('x')).toBe('x')
    expect(parseLaunchPreference(3)).toBe('last')
  })
})

describe('an app is offered only from an ANSWERED list (D315)', () => {
  it('lists last-used plus every app the hub offered', () => {
    expect(offeredLaunchPreferences(answered)).toEqual(['last', 'shell', 'other'])
  })
  it.each([PENDING, UNKNOWN])('offers only "last used" while the list is %j', (catalog) => {
    expect(offeredLaunchPreferences(catalog)).toEqual(['last'])
  })
})

describe('resolving the app to show', () => {
  it('an embedded app that the list holds opens', () => {
    expect(resolveApp('other', answered)).toBe('other')
  })
  it('the hosted app, an app not listed, and any wish before an answer resolve to the shell', () => {
    expect(resolveApp('shell', answered)).toBeNull()
    expect(resolveApp('gone', answered)).toBeNull()
    expect(resolveApp('other', PENDING)).toBeNull()
    expect(resolveApp('other', UNKNOWN)).toBeNull()
    expect(resolveApp(null, answered)).toBeNull()
  })
  it('"last used" reopens the last app; a fixed choice wins over it', () => {
    expect(resolveLaunchApp('last', 'other', answered)).toBe('other')
    expect(resolveLaunchApp('shell', 'other', answered)).toBeNull()
  })
})

describe('the launch resolution waits for the list only when it matters', () => {
  it('a wish for the shell never waits', () => {
    expect(launchResolvable('last', null, PENDING)).toBe(true)
  })
  it('a wish for an embedded app waits while the list is pending, then settles (even on a failed read)', () => {
    expect(launchResolvable('other', null, PENDING)).toBe(false)
    expect(launchResolvable('last', 'other', PENDING)).toBe(false)
    expect(launchResolvable('other', null, answered)).toBe(true)
    expect(launchResolvable('other', null, UNKNOWN)).toBe(true)
  })
})

describe('the app after a server switch', () => {
  const pending: AppCatalog = { status: 'pending' }
  const fallback = 'shell-fallback'

  it('stays on the same app when the new server offers it', () => {
    expect(resolveSwitchApp({ previous: 'other', remembered: undefined, catalog: answered, fallback })).toBe('other')
    expect(resolveSwitchApp({ previous: 'other', remembered: 'shell', catalog: answered, fallback })).toBe('other')
    expect(resolveSwitchApp({ previous: null, remembered: 'other', catalog: answered, fallback })).toBeNull()
  })

  it('otherwise opens the last app used on THAT server', () => {
    expect(resolveSwitchApp({ previous: 'gone', remembered: 'other', catalog: answered, fallback })).toBe('other')
    // A remembered app that server no longer offers does not count.
    expect(resolveSwitchApp({ previous: 'gone', remembered: 'also-gone', catalog: answered, fallback })).toBe(fallback)
  })

  it('with no history falls back to the launch default', () => {
    expect(resolveSwitchApp({ previous: 'gone', remembered: undefined, catalog: answered, fallback })).toBe(fallback)
    expect(resolveSwitchApp({ previous: 'other', remembered: undefined, catalog: { status: 'unknown' }, fallback })).toBe(fallback)
  })

  it('an embedded app waits for the new list to answer; the shell does not', () => {
    expect(switchResolvable('other', pending)).toBe(false)
    expect(switchResolvable('other', answered)).toBe(true)
    expect(switchResolvable('other', { status: 'unknown' })).toBe(true)
    expect(switchResolvable(null, pending)).toBe(true)
  })
})
