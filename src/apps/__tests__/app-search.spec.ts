import { describe, expect, it } from 'vitest'

import { parseAppInfos, type AppCatalog } from '../app-catalog.js'
import { navSearchEntries, searchAll, searchNav, type SearchDevice, type SearchIntegration } from '../app-search.js'

const L = (key: string, fallback: string) => ({ key, fallback })
const translate = (label: { key: string; fallback: string }): string => label.fallback

function app(id: string, items: readonly Record<string, unknown>[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    addonId: `addon-${id}`,
    app: {
      id,
      label: L(`apps.${id}`, id),
      icon: 'monitor',
      entry: { kind: 'web', path: `/${id}`, auth: 'handoff' },
      reach: { kind: 'hub' },
      adminOnly: false,
      nav: [{ id: 's', label: null, items }],
      takesSharedSearch: true,
      settings: null,
      ...extra,
    },
  }
}
const item = (id: string, label: string, keywords?: string[]) => ({ id, label: L(`k.${id}`, label), icon: 'bell', path: `/${id}`, ...(keywords ? { keywords } : {}) })

const catalog: AppCatalog = {
  status: 'answered',
  apps: parseAppInfos([
    app('alpha', [item('logs', 'Logs', ['journal', 'errors']), item('nodes', 'Nodes')]),
    app('beta', [item('backups', 'Backups'), item('logbook', 'Logbook')]),
  ]) ?? [],
}

describe('searching every offered app nav', () => {
  const entries = navSearchEntries(catalog, translate)

  it('indexes the nav of every app, not only the active one', () => {
    expect(entries.map((e) => `${e.appId}:${e.itemId}`)).toEqual(['alpha:logs', 'alpha:nodes', 'beta:backups', 'beta:logbook'])
  })

  it('matches the label, case-insensitively', () => {
    expect(searchNav(entries, 'NODES').map((r) => r.itemId)).toEqual(['nodes'])
  })

  it('matches a keyword', () => {
    expect(searchNav(entries, 'journal').map((r) => r.itemId)).toEqual(['logs'])
  })

  it('ranks a label that starts with the query before one that only contains it', () => {
    expect(searchNav(entries, 'log').map((r) => r.itemId)).toEqual(['logs', 'logbook'])
  })

  it('a result names the app it belongs to, so a tap can switch to it', () => {
    const [hit] = searchNav(entries, 'backups')
    expect(hit).toMatchObject({ appId: 'beta', path: '/backups' })
  })

  it('an empty query finds nothing; a pending catalog indexes nothing', () => {
    expect(searchNav(entries, '  ')).toEqual([])
    expect(navSearchEntries({ status: 'pending' }, translate)).toEqual([])
  })
})

describe('searchAll adds devices and integrations', () => {
  const devices: readonly SearchDevice[] = [
    { id: 1, name: 'Front door', location: 'Entrance', integrationLabel: 'Reolink' },
    { id: 2, name: 'Garage', location: null, integrationLabel: null },
  ]
  const integrations: readonly SearchIntegration[] = [{ id: 'reolink', label: 'Reolink', count: 3 }]
  const entries = navSearchEntries(catalog, translate)

  it('finds a device by name or location and an integration by label', () => {
    const r = searchAll({ query: 'door', navEntries: entries, devices, integrations })
    expect(r.devices.map((d) => d.id)).toEqual([1])
    expect(searchAll({ query: 'entrance', navEntries: entries, devices, integrations }).devices.map((d) => d.id)).toEqual([1])
    expect(searchAll({ query: 'reo', navEntries: entries, devices, integrations }).integrations.map((i) => i.id)).toEqual(['reolink'])
  })

  it('caps each group', () => {
    const many = Array.from({ length: 30 }, (_, i): SearchDevice => ({ id: i, name: `Cam ${i}`, location: null, integrationLabel: null }))
    expect(searchAll({ query: 'cam', navEntries: [], devices: many, integrations: [], limit: 5 }).devices).toHaveLength(5)
  })

  it('reports whether there is anything at all', () => {
    expect(searchAll({ query: 'zzz', navEntries: entries, devices, integrations }).empty).toBe(true)
    expect(searchAll({ query: 'garage', navEntries: entries, devices, integrations }).empty).toBe(false)
  })
})
