/**
 * The ONE-TIME move into the two settings levels (operator decision
 * 2026-10-21): every setting lives at exactly one level — DEVICE (this
 * install) or ACCOUNT (per user, per hub, cached here as `<key>@<serverId>`
 * and synced by `account/account-settings-sync.ts`) — and a few fields stop
 * being persisted at all.
 *
 *   settings        one document           → device half stays under the key;
 *                                             account half → `settings-account@<hub>`
 *   language,       one value each         → `<key>@<hub>` per signed-in hub
 *   reel filter,
 *   reel highlight,
 *   picker group-by
 *   events filter   `…@<hub>`              → only showStationary kept (a stored sortMode is ignored)
 *   camera-local    `…@<hub>`              → timeline filters dropped
 *   grids           `options.layout`       → grid-local `byId[gridId].layout`
 *   device-settings `settingsSegment`      → dropped
 *   the settings-template link, the rules-strip tab → removed
 *
 * The account values were ONE copy for the whole device, so each signed-in hub
 * gets that copy — the app looks exactly as it did on every hub.
 *
 * Runs inside the scope bind (`app/ServerScopeBinder.tsx`), after
 * `server-scope-migration.ts` (whose per-hub copies it trims) and before any
 * account store reads a per-hub copy. A MOVE in the same order as its
 * predecessors: new homes are written first, then the old keys go, so an
 * interrupted pass leaves a duplicate ("existing wins" next time), never a
 * loss. Idempotent: once nothing is left to move, it writes nothing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '../lib/logger.js'
import { SETTINGS_ACCOUNT_STORAGE_KEY, SETTINGS_STORAGE_KEY, parseSettings } from './settings-store.js'
import { pickSettingsLevel } from './settings-levels.js'
import { LANGUAGE_STORAGE_KEY } from './language-store.js'
import { REEL_FILTER_STORAGE_KEY } from './reel-filter-store.js'
import { REEL_HIGHLIGHT_STORAGE_KEY } from './reel-highlight-store.js'
import { DEVICE_PICKER_GROUP_KEY } from './device-picker-group-store.js'
import { EVENTS_FILTER_LEVELS, EVENTS_FILTER_STORAGE_KEY } from './events-filter-store.js'
import { CAMERA_LOCAL_LEVELS, CAMERA_LOCAL_STORAGE_KEY } from './camera-local-store.js'
import { GRIDS_STORAGE_KEY } from './grid-store.js'
import { GRID_LOCAL_STORAGE_KEY } from './grid-local-store.js'
import { DEVICE_SETTINGS_LEVELS, DEVICE_SETTINGS_STORAGE_KEY } from './device-settings-store.js'
import { scopedStorageKey } from './server-scope.js'

/** Keys that are removed and must never be written again. */
export const RETIRED_STORAGE_KEYS = {
  /** The settings-template link (the template mechanism was deleted). */
  settingsTemplateLink: 'v2.settingsTemplateLink',
  /** The Rules tab's strip tab — ephemeral now. */
  rulesStripTab: 'camstack.v2.nc-rules-strip',
} as const

/** The device-wide values that become one account copy per hub. */
const UNSCOPED_ACCOUNT_KEYS: readonly string[] = [
  LANGUAGE_STORAGE_KEY,
  REEL_FILTER_STORAGE_KEY,
  REEL_HIGHLIGHT_STORAGE_KEY,
  DEVICE_PICKER_GROUP_KEY,
]

/** What the pass reads: key → stored string (null = absent). */
export type TwoLevelsDocs = Readonly<Record<string, string | null>>

export interface TwoLevelsWrites {
  readonly set: Readonly<Record<string, string>>
  readonly remove: readonly string[]
}

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseJson(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Every key the pass needs to read for these hubs. */
export function twoLevelsMigrationKeys(serverIds: readonly string[]): readonly string[] {
  const perHub = serverIds.flatMap((id) =>
    [SETTINGS_ACCOUNT_STORAGE_KEY, EVENTS_FILTER_STORAGE_KEY, CAMERA_LOCAL_STORAGE_KEY, ...UNSCOPED_ACCOUNT_KEYS].map(
      (base) => scopedStorageKey(base, id),
    ),
  )
  return [
    SETTINGS_STORAGE_KEY,
    GRIDS_STORAGE_KEY,
    GRID_LOCAL_STORAGE_KEY,
    DEVICE_SETTINGS_STORAGE_KEY,
    ...UNSCOPED_ACCOUNT_KEYS,
    ...Object.values(RETIRED_STORAGE_KEYS),
    ...perHub,
  ]
}

function present(docs: TwoLevelsDocs, key: string): boolean {
  return docs[key] !== null && docs[key] !== undefined
}

function splitSettings(docs: TwoLevelsDocs, serverIds: readonly string[], set: Record<string, string>): void {
  const raw = docs[SETTINGS_STORAGE_KEY] ?? null
  const stored = parseJson(raw)
  // Nothing at the account level left in the device document: already split.
  if (!isRecord(stored) || Object.keys(pickSettingsLevel(stored, 'account')).length === 0) return
  // Through the parser, so every legacy spelling it still reads (an old key,
  // a migration stamp) lands as the current one on its side.
  const parsed = parseSettings(raw)
  const account = JSON.stringify(pickSettingsLevel(parsed, 'account'))
  for (const id of serverIds) {
    const key = scopedStorageKey(SETTINGS_ACCOUNT_STORAGE_KEY, id)
    if (!present(docs, key)) set[key] = account
  }
  set[SETTINGS_STORAGE_KEY] = JSON.stringify(pickSettingsLevel(parsed, 'device'))
}

function scopeUnscoped(
  docs: TwoLevelsDocs,
  serverIds: readonly string[],
  set: Record<string, string>,
  remove: string[],
): void {
  for (const base of UNSCOPED_ACCOUNT_KEYS) {
    const value = docs[base]
    if (value === null || value === undefined) continue
    for (const id of serverIds) {
      const key = scopedStorageKey(base, id)
      if (!present(docs, key)) set[key] = value
    }
    remove.push(base)
  }
}

/** Drop the fields of `doc` whose level is one of `dropped` (default: the
 *  ephemeral ones); null = unchanged. */
function dropEphemeral(
  raw: string | null | undefined,
  levels: Readonly<Record<string, string>>,
  dropped: readonly string[] = ['ephemeral'],
): JsonRecord | null {
  const doc = parseJson(raw)
  if (!isRecord(doc)) return null
  const kept = Object.fromEntries(Object.entries(doc).filter(([k]) => !dropped.includes(levels[k] ?? '')))
  return Object.keys(kept).length === Object.keys(doc).length ? null : kept
}

function trimPerHubDocs(docs: TwoLevelsDocs, serverIds: readonly string[], set: Record<string, string>): void {
  for (const id of serverIds) {
    const eventsKey = scopedStorageKey(EVENTS_FILTER_STORAGE_KEY, id)
    // The account document keeps only its account fields: the device half has
    // its own document (`camstack.v2.library-filter.events`), never synced.
    const events = dropEphemeral(docs[eventsKey], EVENTS_FILTER_LEVELS, ['ephemeral', 'device'])
    if (events !== null) set[eventsKey] = JSON.stringify(events)

    const localKey = scopedStorageKey(CAMERA_LOCAL_STORAGE_KEY, id)
    const local = parseJson(docs[localKey])
    if (!isRecord(local) || !isRecord(local.byId)) continue
    let changed = false
    const byId: Record<string, unknown> = {}
    for (const [cameraId, entry] of Object.entries(local.byId)) {
      const trimmed = dropEphemeral(JSON.stringify(entry), CAMERA_LOCAL_LEVELS)
      if (trimmed === null) {
        byId[cameraId] = entry
        continue
      }
      changed = true
      if (Object.keys(trimmed).length > 0) byId[cameraId] = trimmed
    }
    if (changed) set[localKey] = JSON.stringify({ ...local, byId })
  }
}

function moveGridLayouts(docs: TwoLevelsDocs, set: Record<string, string>): void {
  const grids = parseJson(docs[GRIDS_STORAGE_KEY])
  if (!Array.isArray(grids)) return
  const moved: Record<string, unknown> = {}
  let changed = false
  const next = grids.map((grid: unknown) => {
    if (!isRecord(grid) || !isRecord(grid.options) || !('layout' in grid.options)) return grid
    changed = true
    const { layout, ...options } = grid.options
    if (typeof grid.id === 'string' && typeof layout === 'number') moved[grid.id] = layout
    return { ...grid, options }
  })
  if (!changed) return
  if (Object.keys(moved).length > 0) {
    const local = parseJson(docs[GRID_LOCAL_STORAGE_KEY])
    const doc = isRecord(local) ? local : {}
    const byId: Record<string, unknown> = isRecord(doc.byId) ? { ...doc.byId } : {}
    for (const [gridId, layout] of Object.entries(moved)) {
      const entry = byId[gridId]
      // A layout this device already keeps for the grid is newer: it wins.
      byId[gridId] = isRecord(entry) ? { layout, ...entry } : { layout }
    }
    set[GRID_LOCAL_STORAGE_KEY] = JSON.stringify({ ...doc, byId })
  }
  set[GRIDS_STORAGE_KEY] = JSON.stringify(next)
}

/** Pure: the writes that move every value into its level. */
export function planTwoLevelsMigration(docs: TwoLevelsDocs, serverIds: readonly string[]): TwoLevelsWrites {
  const set: Record<string, string> = {}
  const remove: string[] = []
  splitSettings(docs, serverIds, set)
  scopeUnscoped(docs, serverIds, set, remove)
  trimPerHubDocs(docs, serverIds, set)
  moveGridLayouts(docs, set)
  const device = dropEphemeral(docs[DEVICE_SETTINGS_STORAGE_KEY], DEVICE_SETTINGS_LEVELS)
  if (device !== null) set[DEVICE_SETTINGS_STORAGE_KEY] = JSON.stringify(device)
  for (const key of Object.values(RETIRED_STORAGE_KEYS)) if (present(docs, key)) remove.push(key)
  return { set, remove }
}

/** Old documents rewritten LAST, so an interrupted pass never drops a value. */
const REWRITTEN_LAST: readonly string[] = [SETTINGS_STORAGE_KEY, GRIDS_STORAGE_KEY]

async function runTwoLevelsMigration(serverIds: readonly string[]): Promise<void> {
  const keys = twoLevelsMigrationKeys(serverIds)
  const docs: Record<string, string | null> = {}
  for (const key of keys) docs[key] = await AsyncStorage.getItem(key)
  const writes = planTwoLevelsMigration(docs, serverIds)
  const written = Object.keys(writes.set)
  const ordered = [
    ...written.filter((k) => !REWRITTEN_LAST.includes(k)),
    ...written.filter((k) => REWRITTEN_LAST.includes(k)),
  ]
  for (const key of ordered) {
    const value = writes.set[key]
    if (value !== undefined) await AsyncStorage.setItem(key, value)
  }
  for (const key of writes.remove) await AsyncStorage.removeItem(key)
  if (written.length > 0 || writes.remove.length > 0) {
    log.info('prefs', 'moved settings into the device and account levels', {
      written,
      removed: writes.remove,
      serverIds,
    })
  }
}

let once: Promise<void> | null = null

/**
 * Run the move at most once per process. A failure is logged and not retried
 * this session; the next launch tries again (nothing was removed before its
 * new home was written).
 */
export function migrateTwoLevelsOnce(serverIds: readonly string[]): Promise<void> {
  if (once === null) {
    const unique = [...new Set(serverIds)]
    once = runTwoLevelsMigration(unique).catch((e: unknown) => {
      log.error('prefs', 'two-levels migration failed', { error: e instanceof Error ? e.message : String(e) })
    })
  }
  return once
}

/** Test seam: forget that the pass ran. */
export function resetTwoLevelsMigrationForTests(): void {
  once = null
}
