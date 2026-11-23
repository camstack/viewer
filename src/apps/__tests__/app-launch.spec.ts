import { describe, expect, it } from 'vitest'

import type { AdminVerdict } from '../../data/use-me.js'
import {
  adminSurfacesOffered,
  launchResolvable,
  offeredApps,
  offeredLaunchPreferences,
  parseAppId,
  parseLaunchPreference,
  resolveLaunchApp,
  type AppId,
  type LaunchPreference,
} from '../app-launch.js'
import { drawerBlocks } from '../drawer-model.js'

const VERDICTS: readonly AdminVerdict[] = ['pending', 'admin', 'not-admin', 'unknown']

describe('Admin and Nodes are offered only on an ANSWERED admin (D315)', () => {
  it.each(VERDICTS)('verdict %s', (verdict) => {
    const offered = verdict === 'admin'
    expect(adminSurfacesOffered(verdict)).toBe(offered)
    expect(offeredApps(verdict)).toEqual(offered ? ['viewer', 'admin'] : ['viewer'])
    expect(drawerBlocks(verdict, 1)).toEqual({ adminApp: offered, nodes: offered, servers: false })
  })

  it('the saved-servers block needs at least two servers', () => {
    expect(drawerBlocks('admin', 2).servers).toBe(true)
  })
})

describe('the open-at-launch picker', () => {
  it('offers Admin only to a confirmed admin; Node UIs are never an option', () => {
    expect(offeredLaunchPreferences('admin')).toEqual(['last', 'viewer', 'admin'])
    for (const verdict of ['pending', 'not-admin', 'unknown'] as const) {
      expect(offeredLaunchPreferences(verdict)).toEqual(['last', 'viewer'])
    }
  })
})

describe('the app that opens at launch', () => {
  const cases: ReadonlyArray<readonly [LaunchPreference, AppId, AdminVerdict, AppId, boolean]> = [
    // preference, last app, verdict, resolves to, may settle now
    ['last', 'viewer', 'admin', 'viewer', true],
    ['last', 'viewer', 'pending', 'viewer', true],
    ['last', 'viewer', 'not-admin', 'viewer', true],
    ['last', 'viewer', 'unknown', 'viewer', true],
    ['last', 'admin', 'admin', 'admin', true],
    ['last', 'admin', 'pending', 'viewer', false],
    ['last', 'admin', 'not-admin', 'viewer', true],
    ['last', 'admin', 'unknown', 'viewer', true],
    ['viewer', 'admin', 'admin', 'viewer', true],
    ['viewer', 'admin', 'pending', 'viewer', true],
    ['viewer', 'admin', 'not-admin', 'viewer', true],
    ['viewer', 'admin', 'unknown', 'viewer', true],
    ['admin', 'viewer', 'admin', 'admin', true],
    ['admin', 'viewer', 'pending', 'viewer', false],
    ['admin', 'viewer', 'not-admin', 'viewer', true],
    ['admin', 'viewer', 'unknown', 'viewer', true],
  ]

  it.each(cases)('preference %s, last %s, verdict %s -> %s (settles now: %s)', (preference, last, verdict, app, now) => {
    expect(resolveLaunchApp(preference, last, verdict)).toBe(app)
    expect(launchResolvable(preference, last, verdict)).toBe(now)
  })
})

describe('parsing the persisted values', () => {
  it('falls back to the defaults on anything unknown', () => {
    expect(parseAppId('node')).toBe('viewer')
    expect(parseAppId(undefined)).toBe('viewer')
    expect(parseAppId('admin')).toBe('admin')
    expect(parseLaunchPreference('node')).toBe('last')
    expect(parseLaunchPreference(7)).toBe('last')
    expect(parseLaunchPreference('admin')).toBe('admin')
  })
})
