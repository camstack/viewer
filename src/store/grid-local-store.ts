/**
 * grid-local-store — per-grid state that belongs to THIS DEVICE and is never
 * part of the operator's account settings.
 *
 * A grid's DEFINITION (name, members, overlays, highlight) is an ACCOUNT
 * setting: a wall tablet signed in as the same user shows the same walls. How
 * the wall is LAID OUT, what it SOUNDS like and which stream tier it pulls are
 * not — a tablet and a phone have different screens, and a tablet on the hall's
 * LAN and a phone on 4G want different tiers. Those answers live here, keyed by
 * grid id:
 *
 *   • audioOnIds — cameras whose audio starts ON when the grid opens
 *   • quality    — the wall's stream tier ('auto' lets the broker pick)
 *   • layout     — 'auto' or a fixed column count (moved here 2026-10-21 by
 *                  `two-levels-migration.ts` out of the grid's `options`)
 *
 * The values on disk before the split are moved here ONCE by
 * `device-local-migration.ts`, which `hydrate()` awaits first.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '../lib/logger.js'
import { isStreamQuality, type StreamQuality } from './settings-store.js'
import { migrateDeviceLocalOnce } from './device-local-migration.js'
import { isGridLayout, type GridLayout } from './grid-store.js'

/** One grid's device-local state. Absent fields = never set. */
export interface GridLocal {
  /** Device ids whose audio starts ON when the grid opens. Absent ⇒ all muted. */
  readonly audioOnIds?: readonly number[]
  /** Stream quality hint for the wall's tiles. Absent ⇒ 'auto'. */
  readonly quality?: StreamQuality
  /** Wall layout on this screen. Absent ⇒ 'auto'. */
  readonly layout?: GridLayout
}

/** The full persisted document, keyed by grid id. */
export interface AppGridLocal {
  readonly byId: Readonly<Record<string, GridLocal>>
}

/** AsyncStorage key for the persisted document. */
export const GRID_LOCAL_STORAGE_KEY = '@camstack/v2/grid-local'

/** The tier a wall uses when this device has never picked one. */
export const GRID_QUALITY_DEFAULT: StreamQuality = 'auto'

/** An entry that has never been touched. */
export const EMPTY_GRID_LOCAL: GridLocal = Object.freeze({})

export function resetGridLocalEntry(): AppGridLocal {
  return { byId: {} }
}

// ── Pure reducers over ONE grid's entry (unit-tested) ────────────────────────
// Entry-level so the ad-hoc wall (unpersisted, held in screen state) and the
// store share one implementation.

interface MutableGridLocal {
  audioOnIds?: readonly number[]
  quality?: StreamQuality
  layout?: GridLayout
}

function compact(entry: GridLocal): GridLocal {
  const next: MutableGridLocal = {}
  if (entry.audioOnIds && entry.audioOnIds.length > 0) next.audioOnIds = entry.audioOnIds
  if (entry.quality) next.quality = entry.quality
  if (entry.layout !== undefined && entry.layout !== 'auto') next.layout = entry.layout
  return next
}

/** Toggle whether a camera's audio starts ON when the grid opens. */
export function withGridAudioInitial(entry: GridLocal, deviceId: number, on: boolean): GridLocal {
  const ids = new Set(entry.audioOnIds ?? [])
  if (on) ids.add(deviceId)
  else ids.delete(deviceId)
  return compact({ ...entry, audioOnIds: [...ids] })
}

/** Audio ON for every `deviceIds` camera, or OFF for all (the bar's quick
 *  mute/unmute-all). Replaces the existing set. */
export function withAllGridAudio(entry: GridLocal, deviceIds: readonly number[], on: boolean): GridLocal {
  return compact({ ...entry, audioOnIds: on ? [...new Set(deviceIds)] : [] })
}

/** Set the wall's stream tier. */
export function withGridQuality(entry: GridLocal, quality: StreamQuality): GridLocal {
  return compact({ ...entry, quality })
}

/** Set the wall's layout ('auto' is stored as absence). */
export function withGridLayout(entry: GridLocal, layout: GridLayout): GridLocal {
  return compact({ ...entry, layout })
}

/** The wall's effective layout on this device: the stored pick, or 'auto'. */
export function resolveGridLayout(entry: GridLocal | undefined): GridLayout {
  return entry?.layout ?? 'auto'
}

/** The wall's effective tier: the stored pick, or the default. */
export function resolveGridQuality(entry: GridLocal | undefined): StreamQuality {
  return entry?.quality ?? GRID_QUALITY_DEFAULT
}

/** Apply one entry reducer to one grid id; an entry that says nothing is
 *  stored as absence. */
export function updateGridLocalEntry(
  doc: AppGridLocal,
  gridId: string,
  reduce: (entry: GridLocal) => GridLocal,
): AppGridLocal {
  const next = reduce(doc.byId[gridId] ?? EMPTY_GRID_LOCAL)
  const { [gridId]: _dropped, ...rest } = doc.byId
  return Object.keys(next).length === 0 ? { byId: rest } : { byId: { ...rest, [gridId]: next } }
}

// ── Parsing at the storage boundary ──────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** One stored entry, validated; null when nothing survives. A stored quality
 *  this build no longer has (the retired `medium`) is dropped → the default. */
export function parseGridLocalEntry(raw: unknown): GridLocal | null {
  if (!isRecord(raw)) return null
  const next: MutableGridLocal = {}
  if (Array.isArray(raw.audioOnIds)) {
    const ids = [...new Set(raw.audioOnIds.filter((n): n is number => typeof n === 'number'))]
    if (ids.length > 0) next.audioOnIds = ids
  }
  if (isStreamQuality(raw.quality)) next.quality = raw.quality
  if (typeof raw.layout === 'number' && isGridLayout(raw.layout)) next.layout = Math.floor(raw.layout)
  return Object.keys(next).length > 0 ? next : null
}

/** Parse persisted JSON. Never throws: corrupt storage degrades to empty. */
export function parseGridLocal(raw: string | null): AppGridLocal {
  if (!raw) return resetGridLocalEntry()
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return resetGridLocalEntry()
  }
  if (!isRecord(data) || !isRecord(data.byId)) return resetGridLocalEntry()
  const byId: Record<string, GridLocal> = {}
  for (const [gridId, value] of Object.entries(data.byId)) {
    const entry = parseGridLocalEntry(value)
    if (entry) byId[gridId] = entry
  }
  return { byId }
}

// ── zustand store (glue) ─────────────────────────────────────────────────────

interface GridLocalState {
  readonly local: AppGridLocal
  readonly hydrated: boolean
  hydrate: () => Promise<void>
  /** Toggle whether a camera's audio starts ON when the grid opens. */
  setGridAudioInitial: (gridId: string, deviceId: number, on: boolean) => void
  /** Quick mute/unmute-all. */
  setAllGridAudio: (gridId: string, deviceIds: readonly number[], on: boolean) => void
  setGridQuality: (gridId: string, quality: StreamQuality) => void
  setGridLayout: (gridId: string, layout: GridLayout) => void
  /** Re-read from disk — after `two-levels-migration.ts` moved layouts in. */
  reload: () => Promise<void>
}

function persist(local: AppGridLocal): void {
  void AsyncStorage.setItem(GRID_LOCAL_STORAGE_KEY, JSON.stringify(local)).catch((e: unknown) => {
    log.error('grids', 'grid-local persist failed', { error: e instanceof Error ? e.message : String(e) })
  })
}

export const useGridLocalStore = create<GridLocalState>((set, get) => {
  const apply = (gridId: string, reduce: (entry: GridLocal) => GridLocal): void => {
    const local = updateGridLocalEntry(get().local, gridId, reduce)
    set({ local })
    persist(local)
  }
  return {
    local: resetGridLocalEntry(),
    hydrated: false,

    hydrate: async () => {
      if (get().hydrated) return
      try {
        await migrateDeviceLocalOnce()
        const raw = await AsyncStorage.getItem(GRID_LOCAL_STORAGE_KEY)
        set({ local: parseGridLocal(raw), hydrated: true })
      } catch (e) {
        log.error('grids', 'grid-local hydrate failed', { error: e instanceof Error ? e.message : String(e) })
        set({ hydrated: true })
      }
    },

    setGridAudioInitial: (gridId, deviceId, on) =>
      apply(gridId, (e) => withGridAudioInitial(e, deviceId, on)),
    setAllGridAudio: (gridId, deviceIds, on) => apply(gridId, (e) => withAllGridAudio(e, deviceIds, on)),
    setGridQuality: (gridId, quality) => apply(gridId, (e) => withGridQuality(e, quality)),
    setGridLayout: (gridId, layout) => apply(gridId, (e) => withGridLayout(e, layout)),
    reload: async () => {
      try {
        const raw = await AsyncStorage.getItem(GRID_LOCAL_STORAGE_KEY)
        set({ local: parseGridLocal(raw), hydrated: true })
      } catch (e) {
        log.error('grids', 'grid-local reload failed', { error: e instanceof Error ? e.message : String(e) })
      }
    },
  }
})
