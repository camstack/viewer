import { describe, expect, it } from 'vitest'

import { parseAppInfos, type AppCatalog } from '../app-catalog.js'
import { buildDrawerModel } from '../drawer-model.js'

const L = (key: string, fallback: string) => ({ key, fallback })
const translate = (label: { key: string; fallback: string }): string => (label.key === 'it.docs' ? 'Documenti' : label.fallback)

function app(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    addonId: `addon-${id}`,
    app: {
      id,
      label: L(`apps.${id}`, id.toUpperCase()),
      icon: 'monitor',
      entry: { kind: 'web', path: `/${id}`, auth: 'handoff' },
      reach: { kind: 'hub' },
      adminOnly: false,
      nav: [],
      takesSharedSearch: true,
      settings: null,
      ...extra,
    },
  }
}

const nav = [
  {
    id: 'main',
    label: L('it.main', 'Main'),
    items: [{ id: 'docs', label: L('it.docs', 'Docs'), icon: 'library', path: '/docs' }],
  },
]

function answered(...entries: Record<string, unknown>[]): AppCatalog {
  return { status: 'answered', apps: parseAppInfos(entries) ?? [] }
}

const hosted = app('shell', { order: 10, entry: { kind: 'native', route: '/cameras' }, settings: { path: '/settings', label: L('s', 'Settings') } })
const embedded = app('other', { nav })

describe('the drawer model', () => {
  it('lists every app the hub offered, the active one ticked', () => {
    const model = buildDrawerModel({ catalog: answered(hosted, embedded), activeAppId: 'other', translate })
    expect(model.apps.map((a) => [a.id, a.selected])).toEqual([
      ['shell', false],
      ['other', true],
    ])
    expect(model.appsState).toBe('answered')
  })

  it('the hosted app is ticked while the active app is the shell itself', () => {
    const model = buildDrawerModel({ catalog: answered(hosted, embedded), activeAppId: null, translate })
    expect(model.apps.find((a) => a.selected)?.id).toBe('shell')
  })

  it('the hosted app publishes no nav, an embedded app publishes its own, translated', () => {
    const shell = buildDrawerModel({ catalog: answered(hosted, embedded), activeAppId: null, translate })
    expect(shell.nav).toEqual([])
    const other = buildDrawerModel({ catalog: answered(hosted, embedded), activeAppId: 'other', translate })
    expect(other.nav[0]?.label).toBe('Main')
    expect(other.nav[0]?.items[0]).toMatchObject({ id: 'docs', label: 'Documenti', path: '/docs', icon: 'library' })
  })

  it('Settings only when the active app declares them', () => {
    const catalog = answered(hosted, embedded)
    expect(buildDrawerModel({ catalog, activeAppId: null, translate }).settings).toEqual({ label: 'Settings', path: '/settings' })
    expect(buildDrawerModel({ catalog, activeAppId: 'other', translate }).settings).toBeNull()
  })

  it('pending is not absent: no app rows, no claim, and the shell keeps its Settings', () => {
    const model = buildDrawerModel({ catalog: { status: 'pending' }, activeAppId: null, translate })
    expect(model.apps).toEqual([])
    expect(model.appsState).toBe('pending')
    expect(model.settings).not.toBeNull()
  })

  it('a hub that could not answer (older hub) still lets the shell reach its Settings', () => {
    const model = buildDrawerModel({ catalog: { status: 'unknown' }, activeAppId: null, translate })
    expect(model.appsState).toBe('unknown')
    expect(model.settings).not.toBeNull()
  })

  it('an active app the answered list no longer holds falls back to the shell', () => {
    const model = buildDrawerModel({ catalog: answered(hosted), activeAppId: 'gone', translate })
    expect(model.apps.find((a) => a.selected)?.id).toBe('shell')
  })

  it('orders by the hub order, then label', () => {
    const a = app('a', { order: 20 })
    const b = app('b', { order: 10 })
    const model = buildDrawerModel({ catalog: answered(a, b), activeAppId: null, translate })
    expect(model.apps.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('the active app is named for the selector row', () => {
    const model = buildDrawerModel({ catalog: answered(hosted, embedded), activeAppId: 'other', translate })
    expect(model.activeApp).toMatchObject({ id: 'other', label: 'OTHER', selected: true })
    expect(buildDrawerModel({ catalog: { status: 'pending' }, activeAppId: 'other', translate }).activeApp).toBeNull()
  })

  it('a nav of one page named like the app itself is not drawn (the selector already says it)', () => {
    const selfNav = [{ id: 'main', label: null, items: [{ id: 'home', label: L('apps.self', 'SELF'), icon: 'wrench', path: '/' }] }]
    const self = app('self', { nav: selfNav })
    expect(buildDrawerModel({ catalog: answered(hosted, self), activeAppId: 'self', translate }).nav).toEqual([])
    // A single page with another name stays.
    const named = app('self', { nav: [{ ...selfNav[0], items: [{ ...selfNav[0].items[0], label: L('x', 'Overview') }] }] })
    expect(buildDrawerModel({ catalog: answered(hosted, named), activeAppId: 'self', translate }).nav).toHaveLength(1)
  })
})

describe('the rail state (planning#763)', () => {
  const t = (l: { fallback: string }): string => l.fallback
  it('a pending or failed list is a placeholder state with no apps, never an empty ready one', () => {
    for (const status of ['pending', 'unknown'] as const) {
      const m = buildDrawerModel({ catalog: { status } as AppCatalog, activeAppId: null, translate: t })
      expect(m.railState).toBe(status)
      expect(m.apps).toEqual([])
      expect(m.heading).toBeNull()
    }
  })
  it('an answered list is ready, with the active app as heading', () => {
    const catalog = answered(app('a'), app('b'))
    const m = buildDrawerModel({ catalog, activeAppId: 'b', translate: t })
    expect(m.railState).toBe('ready')
    expect(m.heading).toBe('B')
    expect(m.apps.map((a) => [a.id, a.selected])).toEqual([['a', false], ['b', true]])
  })
})
