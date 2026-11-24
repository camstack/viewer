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
    const model = buildDrawerModel({ catalog: answered(hosted, embedded), activeAppId: 'other', translate, serverCount: 1 })
    expect(model.apps.map((a) => [a.id, a.selected])).toEqual([
      ['shell', false],
      ['other', true],
    ])
    expect(model.appsState).toBe('answered')
  })

  it('the hosted app is ticked while the active app is the shell itself', () => {
    const model = buildDrawerModel({ catalog: answered(hosted, embedded), activeAppId: null, translate, serverCount: 1 })
    expect(model.apps.find((a) => a.selected)?.id).toBe('shell')
  })

  it('the hosted app publishes no nav, an embedded app publishes its own, translated', () => {
    const shell = buildDrawerModel({ catalog: answered(hosted, embedded), activeAppId: null, translate, serverCount: 1 })
    expect(shell.nav).toEqual([])
    const other = buildDrawerModel({ catalog: answered(hosted, embedded), activeAppId: 'other', translate, serverCount: 1 })
    expect(other.nav[0]?.label).toBe('Main')
    expect(other.nav[0]?.items[0]).toMatchObject({ id: 'docs', label: 'Documenti', path: '/docs', icon: 'library' })
  })

  it('Settings only when the active app declares them', () => {
    const catalog = answered(hosted, embedded)
    expect(buildDrawerModel({ catalog, activeAppId: null, translate, serverCount: 1 }).settings).toEqual({ label: 'Settings', path: '/settings' })
    expect(buildDrawerModel({ catalog, activeAppId: 'other', translate, serverCount: 1 }).settings).toBeNull()
  })

  it('pending is not absent: no app rows, no claim, and the shell keeps its Settings', () => {
    const model = buildDrawerModel({ catalog: { status: 'pending' }, activeAppId: null, translate, serverCount: 1 })
    expect(model.apps).toEqual([])
    expect(model.appsState).toBe('pending')
    expect(model.settings).not.toBeNull()
  })

  it('a hub that could not answer (older hub) still lets the shell reach its Settings', () => {
    const model = buildDrawerModel({ catalog: { status: 'unknown' }, activeAppId: null, translate, serverCount: 1 })
    expect(model.appsState).toBe('unknown')
    expect(model.settings).not.toBeNull()
  })

  it('an active app the answered list no longer holds falls back to the shell', () => {
    const model = buildDrawerModel({ catalog: answered(hosted), activeAppId: 'gone', translate, serverCount: 1 })
    expect(model.apps.find((a) => a.selected)?.id).toBe('shell')
  })

  it('a control with one option is not drawn: the server list needs two servers', () => {
    expect(buildDrawerModel({ catalog: answered(hosted), activeAppId: null, translate, serverCount: 1 }).servers).toBe(false)
    expect(buildDrawerModel({ catalog: answered(hosted), activeAppId: null, translate, serverCount: 2 }).servers).toBe(true)
  })

  it('orders by the hub order, then label', () => {
    const a = app('a', { order: 20 })
    const b = app('b', { order: 10 })
    const model = buildDrawerModel({ catalog: answered(a, b), activeAppId: null, translate, serverCount: 1 })
    expect(model.apps.map((x) => x.id)).toEqual(['b', 'a'])
  })
})
