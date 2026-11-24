import { describe, expect, it } from 'vitest'

import { catalogOf, hostedAppOf, isHostedEntry, parseAppInfos, type AppCatalog } from '../app-catalog.js'

const label = (key: string, fallback: string) => ({ key, fallback })

function declared(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    addonId: `addon-${id}`,
    app: {
      id,
      label: label(`apps.${id}`, id),
      icon: 'monitor',
      entry: { kind: 'web', path: '/', auth: 'handoff' },
      reach: { kind: 'hub' },
      adminOnly: false,
      nav: [],
      takesSharedSearch: true,
      settings: null,
      ...extra,
    },
  }
}

describe('parseAppInfos', () => {
  it('reads a well-formed answer', () => {
    const apps = parseAppInfos([declared('one', { order: 5 })])
    expect(apps).toHaveLength(1)
    expect(apps?.[0]?.app.id).toBe('one')
    expect(apps?.[0]?.app.order).toBe(5)
  })

  it('refuses an answer that is not a list (unreadable, never empty)', () => {
    expect(parseAppInfos(null)).toBeNull()
    expect(parseAppInfos({})).toBeNull()
    expect(parseAppInfos('x')).toBeNull()
  })

  it('skips a malformed app and keeps the others', () => {
    const apps = parseAppInfos([declared('good'), { addonId: 'x', app: { id: 7 } }, 'junk'])
    expect(apps?.map((a) => a.app.id)).toEqual(['good'])
  })

  it('skips a malformed nav item and keeps the rest of the section', () => {
    const nav = [
      {
        id: 's',
        label: null,
        items: [
          { id: 'a', label: label('k.a', 'A'), icon: 'bell', path: '/a', keywords: ['alpha'] },
          { id: 'b', label: 'nope', icon: 'bell', path: '/b' },
        ],
      },
    ]
    const apps = parseAppInfos([declared('one', { nav })])
    expect(apps?.[0]?.app.nav[0]?.items.map((i) => i.id)).toEqual(['a'])
    expect(apps?.[0]?.app.nav[0]?.items[0]?.keywords).toEqual(['alpha'])
  })

  it('keeps settings only when they carry a path', () => {
    const withSettings = parseAppInfos([declared('one', { settings: { path: '/settings', label: label('s', 'Settings') } })])
    expect(withSettings?.[0]?.app.settings?.path).toBe('/settings')
    const broken = parseAppInfos([declared('one', { settings: { label: label('s', 'S') } })])
    expect(broken?.[0]?.app.settings).toBeNull()
  })

  it('reads the three entry kinds', () => {
    const entries = [
      { kind: 'native', route: '/cameras' },
      { kind: 'web', path: '/x', auth: 'session-cookie' },
      { kind: 'addon-page', pageId: 'p' },
    ]
    const apps = parseAppInfos(entries.map((entry, i) => declared(`a${i}`, { entry })))
    expect(apps?.map((a) => a.app.entry.kind)).toEqual(['native', 'web', 'addon-page'])
  })
})

describe('catalogOf — pending is not absent (D315)', () => {
  it('no answer yet is pending', () => {
    expect(catalogOf({ status: 'pending', data: undefined })).toEqual({ status: 'pending' })
  })
  it('a failed read is unknown, not empty', () => {
    expect(catalogOf({ status: 'error', data: undefined })).toEqual({ status: 'unknown' })
  })
  it('an answer is answered, even when empty', () => {
    expect(catalogOf({ status: 'success', data: [] })).toEqual({ status: 'answered', apps: [] })
  })
  it('an unreadable answer is unknown', () => {
    expect(catalogOf({ status: 'success', data: null })).toEqual({ status: 'unknown' })
  })
})

describe('the app the shell hosts itself', () => {
  it('a native entry is the shell', () => {
    expect(isHostedEntry({ kind: 'native', route: '/cameras' })).toBe(true)
  })
  it('a web entry at the viewer mount is the shell too', () => {
    expect(isHostedEntry({ kind: 'web', path: '/viewer/camstack/', auth: 'session-cookie' })).toBe(true)
    expect(isHostedEntry({ kind: 'web', path: '/viewer/camstack', auth: 'session-cookie' })).toBe(true)
  })
  it('any other entry is an embedded app', () => {
    expect(isHostedEntry({ kind: 'web', path: '/', auth: 'handoff' })).toBe(false)
    expect(isHostedEntry({ kind: 'addon-page', pageId: 'p' })).toBe(false)
  })
  it('finds the hosted app in an answered catalog only', () => {
    const apps = parseAppInfos([declared('a'), declared('b', { entry: { kind: 'native', route: '/cameras' } })])
    const catalog: AppCatalog = { status: 'answered', apps: apps ?? [] }
    expect(hostedAppOf(catalog)?.app.id).toBe('b')
    expect(hostedAppOf({ status: 'pending' })).toBeNull()
  })
})
