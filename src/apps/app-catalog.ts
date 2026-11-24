/**
 * app-catalog — the apps the shell may offer, as pure rules over the answer of
 * `apps.listApps` (D1096).
 *
 * No app id is spelled here: an app exists because the hub listed it. The app the
 * shell draws itself (the native Viewer) is the one whose ENTRY says so — a
 * `native` entry, or a web entry at the viewer's own mount — never one picked by
 * name. An app is absent only from a list that ANSWERED (D315): pending and a
 * failed read are their own states.
 */
import type { AppDeclaration, AppEntry, AppInfo, AppLabel, AppNavItem, AppNavSection } from '@camstack/types'

import { isRecord } from '../data/cap-query.js'

/** Where the hub serves the viewer web build. A path, not an app id. */
export const VIEWER_WEB_MOUNT = '/viewer/camstack'

export type AppCatalog =
  | { readonly status: 'pending' }
  | { readonly status: 'unknown' }
  | { readonly status: 'answered'; readonly apps: readonly AppInfo[] }

export interface CatalogQueryResult {
  readonly status: 'pending' | 'error' | 'success'
  readonly data: unknown
}

/** `listApps` as a catalog: no answer yet, an answer that could not be read, or the list. */
export function catalogOf(result: CatalogQueryResult): AppCatalog {
  if (result.status === 'pending') return { status: 'pending' }
  // A refetch that fails keeps the last ANSWERED list: a hiccup must not unmount the app on screen.
  const apps = Array.isArray(result.data) ? parseAppInfos(result.data) : null
  return apps === null ? { status: 'unknown' } : { status: 'answered', apps }
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function parseLabel(raw: unknown): AppLabel | null {
  if (!isRecord(raw)) return null
  const key = str(raw.key)
  const fallback = str(raw.fallback)
  return key !== null && key !== '' && fallback !== null ? { key, fallback } : null
}

function parseEntry(raw: unknown): AppEntry | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'native') {
    const route = str(raw.route)
    return route === null ? null : { kind: 'native', route }
  }
  if (raw.kind === 'web') {
    const path = str(raw.path)
    if (path === null) return null
    return { kind: 'web', path, auth: raw.auth === 'handoff' ? 'handoff' : 'session-cookie' }
  }
  if (raw.kind === 'addon-page') {
    const pageId = str(raw.pageId)
    return pageId === null ? null : { kind: 'addon-page', pageId }
  }
  return null
}

function parseReach(raw: unknown): AppDeclaration['reach'] {
  if (isRecord(raw)) {
    if (raw.kind === 'lan-only') return { kind: 'lan-only' }
    if (raw.kind === 'node' && typeof raw.nodeId === 'string') return { kind: 'node', nodeId: raw.nodeId }
  }
  return { kind: 'hub' }
}

function parseNavItem(raw: unknown): AppNavItem | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  const icon = str(raw.icon)
  const path = str(raw.path)
  const label = parseLabel(raw.label)
  if (id === null || icon === null || path === null || label === null) return null
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.filter((k): k is string => typeof k === 'string') : undefined
  return {
    id,
    label,
    icon,
    path,
    ...(raw.adminOnly === true ? { adminOnly: true } : {}),
    ...(keywords !== undefined ? { keywords } : {}),
    ...(typeof raw.badgeKey === 'string' ? { badgeKey: raw.badgeKey } : {}),
    ...(typeof raw.requiresCapability === 'string' ? { requiresCapability: raw.requiresCapability } : {}),
  }
}

function parseSection(raw: unknown): AppNavSection | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  if (id === null || !Array.isArray(raw.items)) return null
  const items = raw.items.map(parseNavItem).filter((i): i is AppNavItem => i !== null)
  return { id, label: parseLabel(raw.label), items }
}

function parseDeclaration(raw: unknown): AppDeclaration | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  const icon = str(raw.icon)
  const label = parseLabel(raw.label)
  const entry = parseEntry(raw.entry)
  if (id === null || id === '' || icon === null || label === null || entry === null) return null
  const nav = Array.isArray(raw.nav) ? raw.nav.map(parseSection).filter((s): s is AppNavSection => s !== null) : []
  const settingsRaw = raw.settings
  const settingsPath = isRecord(settingsRaw) ? str(settingsRaw.path) : null
  const settingsLabel = isRecord(settingsRaw) ? parseLabel(settingsRaw.label) : null
  return {
    id,
    label,
    icon,
    ...(typeof raw.order === 'number' ? { order: raw.order } : {}),
    entry,
    reach: parseReach(raw.reach),
    adminOnly: raw.adminOnly === true,
    nav,
    takesSharedSearch: raw.takesSharedSearch === true,
    settings: settingsPath === null ? null : { path: settingsPath, ...(settingsLabel !== null ? { label: settingsLabel } : {}) },
  }
}

/** The list as the hub sent it, field by field; `null` when it is not a list at all. */
export function parseAppInfos(raw: unknown): readonly AppInfo[] | null {
  if (!Array.isArray(raw)) return null
  const infos: AppInfo[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const addonId = str(entry.addonId)
    const app = parseDeclaration(entry.app)
    if (addonId !== null && app !== null) infos.push({ addonId, app })
  }
  return infos
}

/** Whether the shell draws this app itself (the native Viewer) instead of framing it. */
export function isHostedEntry(entry: AppEntry): boolean {
  if (entry.kind === 'native') return true
  if (entry.kind !== 'web') return false
  return entry.path.replace(/\/+$/, '') === VIEWER_WEB_MOUNT
}

/** The app the shell hosts, once the list answered. */
export function hostedAppOf(catalog: AppCatalog): AppInfo | null {
  if (catalog.status !== 'answered') return null
  return catalog.apps.find((info) => isHostedEntry(info.app.entry)) ?? null
}

/** An app by id, from an answered list. */
export function findApp(catalog: AppCatalog, appId: string): AppInfo | null {
  if (catalog.status !== 'answered') return null
  return catalog.apps.find((info) => info.app.id === appId) ?? null
}

/** The hub's order, then label: what the drawer lists. */
export function orderApps(apps: readonly AppInfo[]): readonly AppInfo[] {
  return [...apps].sort((a, b) => (a.app.order ?? 1000) - (b.app.order ?? 1000) || a.app.label.fallback.localeCompare(b.app.label.fallback))
}
