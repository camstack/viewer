/**
 * The ONE-TIME move of the hub-blind documents onto the hub they belong to.
 *
 * Until 2026-10-21 the grids list and the two per-camera documents were one
 * copy per DEVICE, keyed by camera id alone — and a camera id is only unique
 * within one hub (`server-scope.ts`). This pass:
 *
 *   grids         [] without `serverId`  → each grid stamped with its hub
 *   camera-prefs  one document           → `camera-prefs@<serverId>` per hub
 *   camera-local  one document           → `camera-local@<serverId>` per hub
 *   favourites    one id list            → `…favourites.v1@<serverId>` per hub
 *   last camera   one id                 → `…last-camera@<serverId>`
 *   events filter one document           → `…events-filter@<serverId>`
 *
 * WHICH hub is decided from what is already on disk, never from the network
 * (the move runs on the way to the first paint and must not wait for a hub):
 * each signed-in server's cached camera list (`camera-list-cache.ts`). A grid
 * goes to the hub whose list holds the most of its camera ids; a camera entry
 * (and a favourite, and the last camera) to the one hub that has that id, and
 * — when several hubs have it, or none does — to the hub that holds most of
 * the document as a whole. The events filter (an investigation narrowed to
 * some cameras) goes whole to the hub holding most of its cameras. With nothing
 * to go on, everything goes to the server active right now.
 *
 * A MOVE: the per-hub copy is written first, then the old key is removed, so
 * an interrupted pass leaves a duplicate (the per-hub copy wins on the next
 * run — "existing wins", as in `device-local-migration.ts`), never a loss.
 * Idempotent: once the old keys are gone and every grid carries a hub, there
 * is nothing left to do.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '../lib/logger.js'
import { CAMERA_PREFS_STORAGE_KEY } from './camera-prefs-store.js'
import { CAMERA_LOCAL_STORAGE_KEY } from './camera-local-store.js'
import { GRIDS_STORAGE_KEY } from './grid-store.js'
import { CAMERA_FAVOURITES_STORAGE_KEY } from './camera-favourites-store.js'
import { EVENTS_FILTER_STORAGE_KEY } from './events-filter-store.js'
import { LAST_CAMERA_STORAGE_KEY } from '../navigation/last-camera.js'
import { scopedStorageKey } from './server-scope.js'
import { migrateDeviceLocalOnce } from './device-local-migration.js'

/** One signed-in hub and the camera ids its cached list holds. */
export interface ServerCameraCandidate {
  readonly serverId: string
  readonly cameraIds: ReadonlySet<number>
}

/** What the pass reads: raw stored JSON (null = absent). */
export interface ServerScopeDocs {
  readonly grids: string | null
  readonly cameraPrefs: string | null
  readonly cameraLocal: string | null
  /** A JSON array of camera ids. Absent from an older caller ⇒ nothing. */
  readonly favourites?: string | null
  /** One camera id as a string. */
  readonly lastCamera?: string | null
  /** The events page's filter document (`cameraIds` among its fields). */
  readonly eventsFilter?: string | null
  /** The per-hub copies that already exist, by `scopedStorageKey`. */
  readonly scoped: Readonly<Record<string, string | null>>
}

/** What the pass writes: key → JSON, and keys to remove. */
export interface ServerScopeWrites {
  readonly set: Readonly<Record<string, string>>
  readonly remove: readonly string[]
}

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

/**
 * The hub that holds the most of `ids`; ties go to `fallback` when it is among
 * the tied, else to the first tied candidate. No overlap at all ⇒ `fallback`.
 */
export function pickOwnerServer(
  ids: readonly number[],
  candidates: readonly ServerCameraCandidate[],
  fallback: string,
): string {
  let best: { readonly serverId: string; readonly hits: number }[] = []
  let bestHits = 0
  for (const c of candidates) {
    const hits = ids.filter((id) => c.cameraIds.has(id)).length
    if (hits === 0 || hits < bestHits) continue
    if (hits > bestHits) {
      bestHits = hits
      best = []
    }
    best = [...best, { serverId: c.serverId, hits }]
  }
  if (best.length === 0) return fallback
  return best.some((b) => b.serverId === fallback) ? fallback : (best[0]?.serverId ?? fallback)
}

/** The ONE hub owning a single camera id, or `documentOwner` when the id is on
 *  several hubs (ambiguous) or on none. */
function ownerOfCamera(
  id: number,
  candidates: readonly ServerCameraCandidate[],
  documentOwner: string,
): string {
  const holders = candidates.filter((c) => c.cameraIds.has(id))
  return holders.length === 1 ? (holders[0]?.serverId ?? documentOwner) : documentOwner
}

function stampGrids(
  raw: string | null,
  candidates: readonly ServerCameraCandidate[],
  fallback: string,
): string | null {
  const grids = parseJson(raw)
  if (!Array.isArray(grids)) return null
  let changed = false
  const next = grids.map((grid: unknown) => {
    if (!isRecord(grid) || typeof grid.serverId === 'string') return grid
    const ids = Array.isArray(grid.cameraIds)
      ? grid.cameraIds.filter((n): n is number => typeof n === 'number')
      : []
    changed = true
    return { ...grid, serverId: pickOwnerServer(ids, candidates, fallback) }
  })
  return changed ? JSON.stringify(next) : null
}

/**
 * Split one `{ byId, order? }` document across hubs. `order` (camera-prefs
 * only) is split the same way, each hub keeping its ids in the stored order.
 * Merged UNDER any per-hub copy that already exists: that copy can only have
 * been written by this build, after the split, so it is the newer answer.
 */
function splitByIdDocument(
  baseKey: string,
  raw: string | null,
  existing: Readonly<Record<string, string | null>>,
  candidates: readonly ServerCameraCandidate[],
  fallback: string,
): Record<string, string> {
  const doc = parseJson(raw)
  if (!isRecord(doc)) return {}
  const byId = isRecord(doc.byId) ? doc.byId : {}
  const hasOrder = Array.isArray(doc.order)
  const order = Array.isArray(doc.order) ? doc.order.filter((n): n is number => typeof n === 'number') : []
  const ids = [...Object.keys(byId).map(Number).filter(Number.isFinite), ...order]
  const documentOwner = pickOwnerServer(ids, candidates, fallback)

  const perServer = new Map<string, { byId: Record<string, unknown>; order: number[] }>()
  const bucket = (serverId: string): { byId: Record<string, unknown>; order: number[] } => {
    const found = perServer.get(serverId)
    if (found !== undefined) return found
    const fresh = { byId: {}, order: [] }
    perServer.set(serverId, fresh)
    return fresh
  }
  for (const [key, entry] of Object.entries(byId)) {
    const id = Number(key)
    const owner = Number.isFinite(id) ? ownerOfCamera(id, candidates, documentOwner) : documentOwner
    bucket(owner).byId[key] = entry
  }
  for (const id of order) bucket(ownerOfCamera(id, candidates, documentOwner)).order.push(id)
  // A document with nothing in it still moves, so the old key can go.
  if (perServer.size === 0) bucket(documentOwner)

  const out: Record<string, string> = {}
  for (const [serverId, part] of perServer) {
    const key = scopedStorageKey(baseKey, serverId)
    const current = parseJson(existing[key] ?? null)
    const currentById = isRecord(current) && isRecord(current.byId) ? current.byId : {}
    const merged: Record<string, unknown> = {
      ...(isRecord(current) ? current : {}),
      byId: { ...part.byId, ...currentById },
    }
    if (hasOrder) {
      const currentOrder = isRecord(current) && Array.isArray(current.order) ? current.order : null
      merged.order = currentOrder !== null && currentOrder.length > 0 ? currentOrder : part.order
    }
    out[key] = JSON.stringify(merged)
  }
  return out
}

function splitFavourites(
  raw: string | null,
  existing: Readonly<Record<string, string | null>>,
  candidates: readonly ServerCameraCandidate[],
  fallback: string,
): Record<string, string> {
  const parsed = parseJson(raw)
  const ids = Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : []
  const documentOwner = pickOwnerServer(ids, candidates, fallback)
  const perServer = new Map<string, number[]>([[documentOwner, []]])
  for (const id of ids) {
    const owner = ownerOfCamera(id, candidates, documentOwner)
    perServer.set(owner, [...(perServer.get(owner) ?? []), id])
  }
  const out: Record<string, string> = {}
  for (const [serverId, part] of perServer) {
    const key = scopedStorageKey(CAMERA_FAVOURITES_STORAGE_KEY, serverId)
    const current = parseJson(existing[key] ?? null)
    const kept = Array.isArray(current) ? current.filter((n): n is number => typeof n === 'number') : []
    out[key] = JSON.stringify([...new Set([...kept, ...part])])
  }
  return out
}

function moveLastCamera(
  raw: string | null,
  existing: Readonly<Record<string, string | null>>,
  candidates: readonly ServerCameraCandidate[],
  fallback: string,
): Record<string, string> {
  const id = raw === null ? NaN : Number(raw)
  if (!Number.isSafeInteger(id) || id <= 0) return {}
  const key = scopedStorageKey(LAST_CAMERA_STORAGE_KEY, ownerOfCamera(id, candidates, pickOwnerServer([id], candidates, fallback)))
  return existing[key] !== undefined && existing[key] !== null ? {} : { [key]: String(id) }
}

function moveEventsFilter(
  raw: string | null,
  existing: Readonly<Record<string, string | null>>,
  candidates: readonly ServerCameraCandidate[],
  fallback: string,
): Record<string, string> {
  const doc = parseJson(raw)
  if (!isRecord(doc)) return {}
  const ids = Array.isArray(doc.cameraIds) ? doc.cameraIds.filter((n): n is number => typeof n === 'number') : []
  const key = scopedStorageKey(EVENTS_FILTER_STORAGE_KEY, pickOwnerServer(ids, candidates, fallback))
  return existing[key] !== undefined && existing[key] !== null ? {} : { [key]: JSON.stringify(doc) }
}

/** Pure: the writes that move every hub-blind document onto its hub. */
export function planServerScopeMigration(
  docs: ServerScopeDocs,
  candidates: readonly ServerCameraCandidate[],
  fallbackServerId: string,
): ServerScopeWrites {
  const set: Record<string, string> = {}
  const remove: string[] = []
  const grids = stampGrids(docs.grids, candidates, fallbackServerId)
  if (grids !== null) set[GRIDS_STORAGE_KEY] = grids
  if (docs.cameraPrefs !== null) {
    Object.assign(set, splitByIdDocument(CAMERA_PREFS_STORAGE_KEY, docs.cameraPrefs, docs.scoped, candidates, fallbackServerId))
    remove.push(CAMERA_PREFS_STORAGE_KEY)
  }
  if (docs.cameraLocal !== null) {
    Object.assign(set, splitByIdDocument(CAMERA_LOCAL_STORAGE_KEY, docs.cameraLocal, docs.scoped, candidates, fallbackServerId))
    remove.push(CAMERA_LOCAL_STORAGE_KEY)
  }
  const moves: readonly {
    readonly raw: string | null | undefined
    readonly key: string
    readonly split: typeof splitFavourites
  }[] = [
    { raw: docs.favourites, key: CAMERA_FAVOURITES_STORAGE_KEY, split: splitFavourites },
    { raw: docs.lastCamera, key: LAST_CAMERA_STORAGE_KEY, split: moveLastCamera },
    { raw: docs.eventsFilter, key: EVENTS_FILTER_STORAGE_KEY, split: moveEventsFilter },
  ]
  for (const move of moves) {
    if (move.raw === null || move.raw === undefined) continue
    Object.assign(set, move.split(move.raw, docs.scoped, candidates, fallbackServerId))
    remove.push(move.key)
  }
  return { set, remove }
}

async function runServerScopeMigration(
  candidates: readonly ServerCameraCandidate[],
  fallbackServerId: string,
): Promise<void> {
  // The device-local move works on the OLD documents; it must finish first.
  await migrateDeviceLocalOnce()
  const scopedKeys = [fallbackServerId, ...candidates.map((c) => c.serverId)].flatMap((id) =>
    [
      CAMERA_PREFS_STORAGE_KEY,
      CAMERA_LOCAL_STORAGE_KEY,
      CAMERA_FAVOURITES_STORAGE_KEY,
      LAST_CAMERA_STORAGE_KEY,
      EVENTS_FILTER_STORAGE_KEY,
    ].map((base) => scopedStorageKey(base, id)),
  )
  const scoped: Record<string, string | null> = {}
  for (const key of scopedKeys) scoped[key] = await AsyncStorage.getItem(key)
  const docs: ServerScopeDocs = {
    grids: await AsyncStorage.getItem(GRIDS_STORAGE_KEY),
    cameraPrefs: await AsyncStorage.getItem(CAMERA_PREFS_STORAGE_KEY),
    cameraLocal: await AsyncStorage.getItem(CAMERA_LOCAL_STORAGE_KEY),
    favourites: await AsyncStorage.getItem(CAMERA_FAVOURITES_STORAGE_KEY),
    lastCamera: await AsyncStorage.getItem(LAST_CAMERA_STORAGE_KEY),
    eventsFilter: await AsyncStorage.getItem(EVENTS_FILTER_STORAGE_KEY),
    scoped,
  }
  const writes = planServerScopeMigration(docs, candidates, fallbackServerId)
  const written = Object.keys(writes.set)
  // Per-hub copies before the grids list, both before the old keys go.
  const ordered = [...written.filter((k) => k !== GRIDS_STORAGE_KEY), ...written.filter((k) => k === GRIDS_STORAGE_KEY)]
  for (const key of ordered) {
    const value = writes.set[key]
    if (value !== undefined) await AsyncStorage.setItem(key, value)
  }
  for (const key of writes.remove) await AsyncStorage.removeItem(key)
  if (written.length > 0 || writes.remove.length > 0) {
    log.info('prefs', 'moved hub-blind documents onto their hub', {
      written,
      removed: writes.remove,
      candidates: candidates.map((c) => ({ serverId: c.serverId, cameras: c.cameraIds.size })),
      fallbackServerId,
    })
  }
}

let once: Promise<void> | null = null

/**
 * Run the move at most once per process. A failure is logged and not retried
 * this session; the stores then read the per-hub copies as they are, and the
 * next launch tries again (the old keys are still there).
 */
export function migrateServerScopeOnce(
  candidates: readonly ServerCameraCandidate[],
  fallbackServerId: string,
): Promise<void> {
  if (once === null) {
    once = runServerScopeMigration(candidates, fallbackServerId).catch((e: unknown) => {
      log.error('prefs', 'server-scope migration failed', { error: e instanceof Error ? e.message : String(e) })
    })
  }
  return once
}

/** Test seam: forget that the pass ran. */
export function resetServerScopeMigrationForTests(): void {
  once = null
}
