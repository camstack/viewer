/**
 * camera-local-store — per-camera state that belongs to THIS DEVICE and is never
 * part of the operator's account settings (`camera-prefs-store` is that half).
 *
 * The way a camera was last LEFT on this phone — its sound, its stream tier —
 * is a fact about the device in hand (its screen, its network), not a
 * preference to hand to a wall tablet signed in as the same user.
 *
 *   • quality         — last stream tier chosen for this camera (restored on open)
 *   • audioOn         — last AUDIO choice (`last-selected` mode of audioOnOpen)
 *   • timelineKinds   — theater-timeline activity kinds shown (partial only)
 *   • timelineClasses — theater-timeline detection classes shown (non-empty only)
 *
 * The two timeline filters are EPHEMERAL (operator decision 2026-10-21): held
 * in memory for the session and never written ({@link CAMERA_LOCAL_LEVELS}).
 *
 * The values on disk before the split are moved here ONCE by
 * `device-local-migration.ts`, which `hydrate()` awaits first.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '../lib/logger.js'
import { isStreamQuality, type StreamQuality } from './settings-store.js'
// Pure, dependency-free module — the canonical home of the activity-kind vocab.
import {
  ALL_BAR_KINDS,
  isFilterAll,
  type TimelineBarKind,
} from '../components/camera/theater/mock-data.js'
import { migrateDeviceLocalOnce } from './device-local-migration.js'
import { onServerScopeChange, scopedStorageKey, whenServerScoped } from './server-scope.js'

// ── Domain types ──────────────────────────────────────────────────────────────

/** One camera's device-local state. All fields optional — absence = never set. */
export interface CameraLocal {
  /** Last stream quality chosen for this camera — restored on next open. */
  readonly quality?: StreamQuality
  /**
   * Last AUDIO choice on this camera: `true` = the operator left it speaking,
   * `false` = they left it silent. Read on open by the `last-selected` mode of
   * `settings.stream.audioOnOpen`.
   *
   * ABSENT means "never chosen here" and is NOT the same as `false` — one is a
   * decision and the other is the lack of one. `opensMuted` treats them alike
   * today; keeping them distinct is what lets that fallback change later
   * without silently rewriting an answer the operator actually gave.
   */
  readonly audioOn?: boolean
  /** Theater-timeline activity classes shown for this camera. Present only when
   *  a PARTIAL selection is active — "all kinds" is stored as absence. */
  readonly timelineKinds?: readonly TimelineBarKind[]
  /** Theater-timeline DETECTION-CLASS selection for this camera. Open
   *  vocabulary; an EMPTY selection means "all classes" and is stored as
   *  absence. */
  readonly timelineClasses?: readonly string[]
}

/** The full persisted document. */
export interface AppCameraLocal {
  readonly byId: Readonly<Record<number, CameraLocal>>
}

/** Every field this store owns — what `device-local-migration.ts` moved here
 *  out of the camera-prefs document. */
export const CAMERA_LOCAL_FIELDS = ['quality', 'audioOn', 'timelineKinds', 'timelineClasses'] as const

/** Which fields are written to disk (device) and which live in memory only. */
export const CAMERA_LOCAL_LEVELS: Readonly<Record<keyof CameraLocal, 'device' | 'ephemeral'>> = {
  quality: 'device',
  audioOn: 'device',
  timelineKinds: 'ephemeral',
  timelineClasses: 'ephemeral',
}

/** The document as it is written: the ephemeral fields dropped, and an entry
 *  left with nothing to say dropped with them. */
export function persistedCameraLocal(local: AppCameraLocal): AppCameraLocal {
  const byId: Record<number, CameraLocal> = {}
  for (const [key, entry] of Object.entries(local.byId)) {
    const kept: MutableCameraLocal = {}
    if (entry.quality !== undefined) kept.quality = entry.quality
    if (entry.audioOn !== undefined) kept.audioOn = entry.audioOn
    if (Object.keys(kept).length > 0) byId[Number(key)] = kept
  }
  return { byId }
}

/** AsyncStorage key for the persisted document. */
export const CAMERA_LOCAL_STORAGE_KEY = '@camstack/v2/camera-local'

/** A fresh, empty document. */
export function resetCameraLocalEntry(): AppCameraLocal {
  return { byId: {} }
}

// ── Pure reducers (unit-tested) ──────────────────────────────────────────────

/** Validate + normalise a timeline-kind selection: dedupe against the known
 *  vocab in display order; a selection covering EVERY kind (or nothing valid)
 *  normalises to undefined — "all" is the default and is stored as absence. */
export function normalizeTimelineKinds(
  kinds: readonly TimelineBarKind[],
): readonly TimelineBarKind[] | undefined {
  const selected = ALL_BAR_KINDS.filter((k) => kinds.includes(k))
  if (selected.length === 0 || selected.length === ALL_BAR_KINDS.length) return undefined
  return selected
}

/** Validate + normalise a detection-class selection: trim, drop empties,
 *  dedupe (first occurrence wins). An empty result normalises to undefined. */
export function normalizeTimelineClasses(
  classes: readonly string[],
): readonly string[] | undefined {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of classes) {
    const trimmed = c.trim()
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out.length > 0 ? out : undefined
}

interface MutableCameraLocal {
  quality?: StreamQuality
  audioOn?: boolean
  timelineKinds?: readonly TimelineBarKind[]
  timelineClasses?: readonly string[]
}

/** Keep only the fields that carry an answer, so an entry that says nothing is
 *  stored as ABSENCE (a camera merely looked at carries no document). */
function compact(merged: CameraLocal): CameraLocal {
  const next: MutableCameraLocal = {}
  if (merged.quality) next.quality = merged.quality
  // NOT a truthiness test: `false` ("left it silent") is an answer.
  if (typeof merged.audioOn === 'boolean') next.audioOn = merged.audioOn
  if (merged.timelineKinds && merged.timelineKinds.length > 0) next.timelineKinds = merged.timelineKinds
  if (merged.timelineClasses && merged.timelineClasses.length > 0) {
    next.timelineClasses = merged.timelineClasses
  }
  return next
}

function mergeLocal(doc: AppCameraLocal, id: number, patch: CameraLocal): AppCameraLocal {
  const next = compact({ ...(doc.byId[id] ?? {}), ...patch })
  const { [id]: _dropped, ...rest } = doc.byId
  return Object.keys(next).length === 0 ? { byId: rest } : { byId: { ...rest, [id]: next } }
}

/** Set a camera's last-used stream quality (restored on next open). */
export function setCameraQualityEntry(
  doc: AppCameraLocal,
  id: number,
  quality: StreamQuality,
): AppCameraLocal {
  return mergeLocal(doc, id, { quality })
}

/** Remember this camera's audio choice (`true` = left speaking). */
export function setCameraAudioOnEntry(
  doc: AppCameraLocal,
  id: number,
  audioOn: boolean,
): AppCameraLocal {
  return mergeLocal(doc, id, { audioOn })
}

/** Set (or reset to "all") a camera's theater-timeline activity-kind filter. */
export function setCameraTimelineKindsEntry(
  doc: AppCameraLocal,
  id: number,
  kinds: readonly TimelineBarKind[],
): AppCameraLocal {
  return mergeLocal(doc, id, { timelineKinds: normalizeTimelineKinds(kinds) })
}

/** Set (or reset to "all") a camera's theater-timeline detection-class filter. */
export function setCameraTimelineClassesEntry(
  doc: AppCameraLocal,
  id: number,
  classes: readonly string[],
): AppCameraLocal {
  return mergeLocal(doc, id, { timelineClasses: normalizeTimelineClasses(classes) })
}

/**
 * Toggle ONE timeline activity KIND, reading the camera's CURRENT stored
 * selection (never a caller-supplied snapshot) so two rapid taps accumulate.
 * From the "all" state a first tap ISOLATES the tapped kind; emptying the set
 * falls back to "all".
 */
export function toggleCameraTimelineKindEntry(
  doc: AppCameraLocal,
  id: number,
  kind: TimelineBarKind,
): AppCameraLocal {
  const current = new Set<TimelineBarKind>(doc.byId[id]?.timelineKinds ?? ALL_BAR_KINDS)
  const base = isFilterAll(current) ? new Set<TimelineBarKind>() : current
  if (base.has(kind)) base.delete(kind)
  else base.add(kind)
  return setCameraTimelineKindsEntry(doc, id, base.size === 0 ? [...ALL_BAR_KINDS] : [...base])
}

/** Toggle ONE timeline detection CLASS, reading the latest stored set. */
export function toggleCameraTimelineClassEntry(
  doc: AppCameraLocal,
  id: number,
  className: string,
): AppCameraLocal {
  const base = new Set<string>(doc.byId[id]?.timelineClasses ?? [])
  if (base.has(className)) base.delete(className)
  else base.add(className)
  return setCameraTimelineClassesEntry(doc, id, [...base])
}

// ── Parsing at the storage boundary ──────────────────────────────────────────

function isTimelineBarKind(v: unknown): v is TimelineBarKind {
  return typeof v === 'string' && (ALL_BAR_KINDS as readonly string[]).includes(v)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** One stored entry, validated field by field; null when nothing survives. */
export function parseCameraLocalEntry(raw: unknown): CameraLocal | null {
  if (!isRecord(raw)) return null
  const next: MutableCameraLocal = {}
  if (isStreamQuality(raw.quality)) next.quality = raw.quality
  if (typeof raw.audioOn === 'boolean') next.audioOn = raw.audioOn
  if (Array.isArray(raw.timelineKinds)) {
    const kinds = normalizeTimelineKinds(raw.timelineKinds.filter(isTimelineBarKind))
    if (kinds !== undefined) next.timelineKinds = kinds
  }
  if (Array.isArray(raw.timelineClasses)) {
    const classes = normalizeTimelineClasses(
      raw.timelineClasses.filter((c): c is string => typeof c === 'string'),
    )
    if (classes !== undefined) next.timelineClasses = classes
  }
  return Object.keys(next).length > 0 ? next : null
}

/** Parse persisted JSON. Never throws: corrupt storage degrades to empty. */
export function parseCameraLocal(raw: string | null): AppCameraLocal {
  if (!raw) return resetCameraLocalEntry()
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return resetCameraLocalEntry()
  }
  if (!isRecord(data) || !isRecord(data.byId)) return resetCameraLocalEntry()
  const byId: Record<number, CameraLocal> = {}
  for (const [key, value] of Object.entries(data.byId)) {
    const id = Number(key)
    if (!Number.isInteger(id)) continue
    const entry = parseCameraLocalEntry(value)
    if (entry) byId[id] = entry
  }
  return { byId }
}

// ── zustand store (glue) ─────────────────────────────────────────────────────

interface CameraLocalState {
  readonly local: AppCameraLocal
  /** True once `hydrate()` has loaded the persisted document. */
  readonly hydrated: boolean
  /** The hub `local` belongs to (`server-scope.ts`); `null` before the first
   *  load. Camera ids are only unique within one hub. */
  readonly serverId: string | null
  hydrate: () => Promise<void>
  setCameraQuality: (id: number, quality: StreamQuality) => void
  /** Remember this camera's audio choice (`true` = left speaking). */
  setCameraAudioOn: (id: number, audioOn: boolean) => void
  setCameraTimelineKinds: (id: number, kinds: readonly TimelineBarKind[]) => void
  setCameraTimelineClasses: (id: number, classes: readonly string[]) => void
  /** Toggle one activity kind, reading the latest stored set (atomic). */
  toggleCameraTimelineKind: (id: number, kind: TimelineBarKind) => void
  /** Toggle one detection class, reading the latest stored set (atomic). */
  toggleCameraTimelineClass: (id: number, className: string) => void
}

function persist(serverId: string | null, local: AppCameraLocal): void {
  if (serverId === null) {
    log.warn('prefs', 'camera-local write before a hub was bound — kept in memory only')
    return
  }
  const doc = JSON.stringify(persistedCameraLocal(local))
  void AsyncStorage.setItem(scopedStorageKey(CAMERA_LOCAL_STORAGE_KEY, serverId), doc).catch((e: unknown) => {
    log.error('prefs', 'camera-local persist failed', { error: e instanceof Error ? e.message : String(e) })
  })
}

export const useCameraLocalStore = create<CameraLocalState>((set, get) => {
  const apply = (reduce: (doc: AppCameraLocal) => AppCameraLocal): void => {
    const local = reduce(get().local)
    set({ local })
    persist(get().serverId, local)
  }
  // A hub switch swaps the whole document, in ONE set, once it is read.
  onServerScopeChange((serverId) => {
    void AsyncStorage.getItem(scopedStorageKey(CAMERA_LOCAL_STORAGE_KEY, serverId))
      .then((raw) => set({ local: parseCameraLocal(raw), serverId, hydrated: true }))
      .catch((e: unknown) => {
        log.error('prefs', 'camera-local reload failed', { error: e instanceof Error ? e.message : String(e) })
        set({ local: resetCameraLocalEntry(), serverId, hydrated: true })
      })
  })
  return {
    local: resetCameraLocalEntry(),
    hydrated: false,
    serverId: null,

    hydrate: async () => {
      if (get().hydrated) return
      try {
        await migrateDeviceLocalOnce()
        const serverId = await whenServerScoped()
        if (get().hydrated) return
        const raw = await AsyncStorage.getItem(scopedStorageKey(CAMERA_LOCAL_STORAGE_KEY, serverId))
        set({ local: parseCameraLocal(raw), serverId, hydrated: true })
      } catch (e) {
        log.error('prefs', 'camera-local hydrate failed', { error: e instanceof Error ? e.message : String(e) })
        set({ hydrated: true })
      }
    },

    setCameraQuality: (id, quality) => apply((d) => setCameraQualityEntry(d, id, quality)),
    setCameraAudioOn: (id, audioOn) => apply((d) => setCameraAudioOnEntry(d, id, audioOn)),
    setCameraTimelineKinds: (id, kinds) => apply((d) => setCameraTimelineKindsEntry(d, id, kinds)),
    setCameraTimelineClasses: (id, classes) =>
      apply((d) => setCameraTimelineClassesEntry(d, id, classes)),
    toggleCameraTimelineKind: (id, kind) => apply((d) => toggleCameraTimelineKindEntry(d, id, kind)),
    toggleCameraTimelineClass: (id, className) =>
      apply((d) => toggleCameraTimelineClassEntry(d, id, className)),
  }
})
