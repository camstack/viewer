/**
 * The ONE-TIME move of device-local state out of the shared documents.
 *
 * Until the profile split, three shared documents carried values that describe
 * the device rather than the operator's preferences:
 *
 *   camera-prefs  byId[id].{quality, audioOn, timelineKinds, timelineClasses}
 *                 → camera-local  byId[id]
 *   grids         [].audioOnIds, [].options.quality
 *                 → grid-local    byId[gridId]
 *   settings      advanced.debugMode
 *                 → device-settings
 *
 * The move is a MOVE: the value lands in the device-local document and the
 * field is removed from the shared one, in the same pass, so there is never a
 * second copy for a reader to pick by mistake. It runs before any of the six
 * stores reads its document (each `hydrate()` awaits {@link migrateDeviceLocalOnce})
 * and is idempotent: a shared document that no longer carries the fields has
 * nothing to move, so later launches write nothing.
 *
 * If a device-local document already holds an answer for the same camera or
 * grid, THAT answer wins — it can only have been written by this build, after
 * the split, and is therefore newer than a leftover in the shared document.
 *
 * Values are moved as stored; each device-local store validates them on parse
 * like any other read from disk.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '../lib/logger.js'
import { CAMERA_PREFS_STORAGE_KEY } from './camera-prefs-store.js'
import { CAMERA_LOCAL_FIELDS, CAMERA_LOCAL_STORAGE_KEY } from './camera-local-store.js'
import { GRIDS_STORAGE_KEY } from './grid-store.js'
import { GRID_LOCAL_STORAGE_KEY } from './grid-local-store.js'
import { SETTINGS_STORAGE_KEY } from './settings-store.js'
import { DEVICE_SETTINGS_STORAGE_KEY } from './device-settings-store.js'

/** The six documents the move reads, as raw stored JSON (null = absent). */
export interface DeviceLocalDocs {
  readonly cameraPrefs: string | null
  readonly cameraLocal: string | null
  readonly grids: string | null
  readonly gridLocal: string | null
  readonly settings: string | null
  readonly deviceSettings: string | null
}

/** The documents the move rewrites — only those that changed. */
export type DeviceLocalWrites = Partial<Record<keyof DeviceLocalDocs, string>>

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Split a record into the listed keys (present, not undefined) and the rest. */
function partition(
  rec: JsonRecord,
  keys: readonly string[],
): { readonly picked: JsonRecord; readonly rest: JsonRecord } {
  const picked: Record<string, unknown> = {}
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rec)) {
    if (keys.includes(k)) {
      if (v !== undefined) picked[k] = v
    } else {
      rest[k] = v
    }
  }
  return { picked, rest }
}

/** Merge moved entries under an existing `byId` document; existing wins. */
function mergeByIdDoc(raw: string | null, moved: Readonly<Record<string, JsonRecord>>): string {
  const parsed = parseJson(raw)
  const existing = isRecord(parsed) && isRecord(parsed.byId) ? parsed.byId : {}
  const byId: Record<string, unknown> = { ...existing }
  for (const [id, fields] of Object.entries(moved)) {
    const current = existing[id]
    byId[id] = isRecord(current) ? { ...fields, ...current } : fields
  }
  return JSON.stringify({ ...(isRecord(parsed) ? parsed : {}), byId })
}

function splitCameraPrefs(docs: DeviceLocalDocs): DeviceLocalWrites {
  const prefs = parseJson(docs.cameraPrefs)
  if (!isRecord(prefs) || !isRecord(prefs.byId)) return {}
  const moved: Record<string, JsonRecord> = {}
  const kept: Record<string, unknown> = {}
  for (const [id, entry] of Object.entries(prefs.byId)) {
    if (!isRecord(entry)) {
      kept[id] = entry
      continue
    }
    const { picked, rest } = partition(entry, CAMERA_LOCAL_FIELDS)
    if (Object.keys(picked).length > 0) moved[id] = picked
    if (Object.keys(rest).length > 0) kept[id] = rest
  }
  if (Object.keys(moved).length === 0) return {}
  return {
    cameraPrefs: JSON.stringify({ ...prefs, byId: kept }),
    cameraLocal: mergeByIdDoc(docs.cameraLocal, moved),
  }
}

function splitGrids(docs: DeviceLocalDocs): DeviceLocalWrites {
  const grids = parseJson(docs.grids)
  if (!Array.isArray(grids)) return {}
  const moved: Record<string, JsonRecord> = {}
  const next = grids.map((grid: unknown) => {
    if (!isRecord(grid) || typeof grid.id !== 'string') return grid
    const { picked: top, rest: gridRest } = partition(grid, ['audioOnIds'])
    const options = isRecord(grid.options) ? partition(grid.options, ['quality']) : null
    const fields: Record<string, unknown> = { ...top, ...(options?.picked ?? {}) }
    if (Object.keys(fields).length === 0) return grid
    moved[grid.id] = fields
    return options === null ? gridRest : { ...gridRest, options: options.rest }
  })
  if (Object.keys(moved).length === 0) return {}
  return {
    grids: JSON.stringify(next),
    gridLocal: mergeByIdDoc(docs.gridLocal, moved),
  }
}

function splitSettings(docs: DeviceLocalDocs): DeviceLocalWrites {
  const settings = parseJson(docs.settings)
  if (!isRecord(settings) || !('advanced' in settings)) return {}
  const { rest } = partition(settings, ['advanced'])
  const advanced = settings.advanced
  const legacyDebug = isRecord(advanced) ? advanced.debugMode : undefined
  const current = parseJson(docs.deviceSettings)
  const base: JsonRecord = isRecord(current) ? current : {}
  const deviceSettings =
    'debugMode' in base || legacyDebug === undefined ? base : { ...base, debugMode: legacyDebug }
  return {
    settings: JSON.stringify(rest),
    ...(deviceSettings !== base || current === null
      ? { deviceSettings: JSON.stringify(deviceSettings) }
      : {}),
  }
}

/**
 * Pure: given the six stored documents, the documents to rewrite. Empty when
 * there is nothing left to move — which is every launch after the first.
 */
export function splitDeviceLocalDocs(docs: DeviceLocalDocs): DeviceLocalWrites {
  return { ...splitCameraPrefs(docs), ...splitGrids(docs), ...splitSettings(docs) }
}

const KEYS: Readonly<Record<keyof DeviceLocalDocs, () => string>> = {
  cameraPrefs: () => CAMERA_PREFS_STORAGE_KEY,
  cameraLocal: () => CAMERA_LOCAL_STORAGE_KEY,
  grids: () => GRIDS_STORAGE_KEY,
  gridLocal: () => GRID_LOCAL_STORAGE_KEY,
  settings: () => SETTINGS_STORAGE_KEY,
  deviceSettings: () => DEVICE_SETTINGS_STORAGE_KEY,
}

/** Read, split, write. Device-local documents are written BEFORE the shared
 *  ones are stripped, so an interrupted pass leaves a duplicate (resolved by
 *  "existing wins" next launch), never a loss. */
async function runDeviceLocalMigration(): Promise<void> {
  const read = async (k: keyof DeviceLocalDocs): Promise<string | null> =>
    await AsyncStorage.getItem(KEYS[k]())
  const docs: DeviceLocalDocs = {
    cameraPrefs: await read('cameraPrefs'),
    cameraLocal: await read('cameraLocal'),
    grids: await read('grids'),
    gridLocal: await read('gridLocal'),
    settings: await read('settings'),
    deviceSettings: await read('deviceSettings'),
  }
  const writes = splitDeviceLocalDocs(docs)
  const order: readonly (keyof DeviceLocalDocs)[] = [
    'cameraLocal',
    'gridLocal',
    'deviceSettings',
    'cameraPrefs',
    'grids',
    'settings',
  ]
  const written: string[] = []
  for (const k of order) {
    const value = writes[k]
    if (value === undefined) continue
    await AsyncStorage.setItem(KEYS[k](), value)
    written.push(k)
  }
  if (written.length > 0) log.info('prefs', 'moved device-local state out of the shared documents', { written })
}

let once: Promise<void> | null = null

/**
 * Run the move at most once per process; every caller awaits the same pass.
 * A failure is logged and NOT retried this session — the stores then read
 * their documents as they are, which is exactly the pre-split behaviour minus
 * the moved fields, and the next launch tries again.
 */
export function migrateDeviceLocalOnce(): Promise<void> {
  if (once === null) {
    once = runDeviceLocalMigration().catch((e: unknown) => {
      log.error('prefs', 'device-local migration failed', { error: e instanceof Error ? e.message : String(e) })
    })
  }
  return once
}

/** Test seam: forget that the pass ran, so a spec can simulate a cold launch. */
export function resetDeviceLocalMigrationForTests(): void {
  once = null
}
