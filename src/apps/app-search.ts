/**
 * app-search — the drawer's one search field, as pure rules (D1096).
 *
 * It covers the nav (label and keywords) of EVERY app the hub offered, plus the
 * devices and the integrations. A nav result carries the app it belongs to, so a
 * tap on another app's result switches to that app.
 */
import type { AppCatalog } from './app-catalog.js'
import { orderApps } from './app-catalog.js'
import type { Translate } from './drawer-model.js'

export const SEARCH_GROUP_LIMIT = 8

export interface NavSearchEntry {
  readonly appId: string
  readonly appLabel: string
  readonly itemId: string
  readonly label: string
  readonly icon: string
  readonly path: string
  /** Lower-cased label, then keywords. */
  readonly haystack: readonly string[]
}

export interface SearchDevice {
  readonly id: number
  readonly name: string
  readonly location: string | null
  readonly integrationLabel: string | null
}

export interface SearchIntegration {
  readonly id: string
  readonly label: string
  readonly count: number
}

export interface SearchResults {
  readonly nav: readonly NavSearchEntry[]
  readonly devices: readonly SearchDevice[]
  readonly integrations: readonly SearchIntegration[]
  readonly empty: boolean
}

/** One entry per nav item of every offered app. A catalog that has not answered indexes nothing. */
export function navSearchEntries(catalog: AppCatalog, translate: Translate): readonly NavSearchEntry[] {
  if (catalog.status !== 'answered') return []
  const entries: NavSearchEntry[] = []
  for (const info of orderApps(catalog.apps)) {
    const appLabel = translate(info.app.label)
    for (const section of info.app.nav) {
      for (const item of section.items) {
        const label = translate(item.label)
        entries.push({
          appId: info.app.id,
          appLabel,
          itemId: item.id,
          label,
          icon: item.icon,
          path: item.path,
          haystack: [label.toLowerCase(), ...(item.keywords ?? []).map((k) => k.toLowerCase())],
        })
      }
    }
  }
  return entries
}

function normalize(query: string): string {
  return query.trim().toLowerCase()
}

/** Lower is better: label starts with the query, label contains it, a keyword contains it. */
function rank(entry: NavSearchEntry, q: string): number | null {
  const [label = '', ...keywords] = entry.haystack
  if (label.startsWith(q)) return 0
  if (label.includes(q)) return 1
  if (keywords.some((k) => k.includes(q))) return 2
  return null
}

export function searchNav(entries: readonly NavSearchEntry[], query: string, limit: number = SEARCH_GROUP_LIMIT): readonly NavSearchEntry[] {
  const q = normalize(query)
  if (q === '') return []
  return entries
    .map((entry, index) => ({ entry, index, score: rank(entry, q) }))
    .filter((hit): hit is { entry: NavSearchEntry; index: number; score: number } => hit.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((hit) => hit.entry)
}

export interface SearchInput {
  readonly query: string
  readonly navEntries: readonly NavSearchEntry[]
  readonly devices: readonly SearchDevice[]
  readonly integrations: readonly SearchIntegration[]
  readonly limit?: number
}

export function searchAll({ query, navEntries, devices, integrations, limit = SEARCH_GROUP_LIMIT }: SearchInput): SearchResults {
  const q = normalize(query)
  if (q === '') return { nav: [], devices: [], integrations: [], empty: true }
  const nav = searchNav(navEntries, q, limit)
  const matchedDevices = devices
    .filter((d) => [d.name, d.location ?? '', d.integrationLabel ?? ''].some((v) => v.toLowerCase().includes(q)))
    .slice(0, limit)
  const matchedIntegrations = integrations.filter((i) => i.label.toLowerCase().includes(q)).slice(0, limit)
  return {
    nav,
    devices: matchedDevices,
    integrations: matchedIntegrations,
    empty: nav.length === 0 && matchedDevices.length === 0 && matchedIntegrations.length === 0,
  }
}
