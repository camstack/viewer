/**
 * camera-prefs-store — per-camera preferences persistence.
 *
 * Holds purely client-side, user-tunable overrides that the server does not own:
 *   • a local display name (rename) per camera id,
 *   • a hidden flag per camera id (hide a camera from the main list),
 *   • a global custom `order` of camera ids (drag-to-reorder).
 *
 * Mirrors `settings-store`: the mutation logic is a set of *pure*, immutable
 * reducers over a `readonly AppCameraPrefs` (unit-tested in isolation); the
 * zustand store is thin glue that holds the value, applies a reducer, and
 * persists to AsyncStorage. Loading is lazy via `hydrate()` (idempotent).
 *
 * Keying is by camera id (number, stringified in the per-camera map so the JSON
 * round-trips cleanly). Unknown / corrupt storage degrades to DEFAULTS field by
 * field, never throwing.
 *
 * EVERYTHING HERE IS AN ACCOUNT SETTING (per user, per hub; synced as the
 * `viewer.cameras` namespace by `account/account-settings-sync.ts`): this
 * device keeps one cached copy per hub (`server-scope.ts`). The per-camera
 * state that describes the DEVICE (stream tier, last audio choice) lives in
 * `camera-local-store.ts` — see why there.
 */
import { create } from 'zustand'
import { log } from '../lib/logger.js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { GRID_HIGHLIGHT_DEFAULTS, type GridHighlightSettings } from './grid-store.js'
import {
  isDefaultOverlay,
  normaliseOverlay,
  OVERLAY_DEFAULTS,
  type CameraOverlayConfig,
} from '../components/camera/overlay/overlay-config.js'
import {
  EMPTY_ACCESSORY_PREFS,
  isEmptyAccessoryPrefs,
  parseAccessoryPrefs,
  type CameraAccessoryPrefs,
} from '../accessories/accessory-prefs.js'
import { migrateDeviceLocalOnce } from './device-local-migration.js'
import { onServerScopeChange, scopedStorageKey, whenServerScoped } from './server-scope.js'

// ── Domain types ──────────────────────────────────────────────────────────────

/** Per-camera local overrides. All fields optional — absence means "no override". */
export interface CameraPref {
  /** User-chosen display name overriding the server name. */
  readonly localName?: string
  /** When true, the camera is excluded from the default list. */
  readonly hidden?: boolean
  /** Per-camera highlight settings for the single (detail) view. Shares the grid
   *  highlight shape; in detail the triggers themselves are the enablement (no
   *  separate master toggle). */
  readonly highlight?: GridHighlightSettings
  /** What this camera draws over its picture. Absent = the defaults, which
   *  reproduce what the screen drew before the overlay config existed. */
  readonly overlay?: CameraOverlayConfig
  /**
   * Which ONE of this camera's clip sources the clip surface reads
   * (`analytics`, `native:reolink:onboard`, …). Open vocabulary: the hub owns
   * it, so a pick this build has never heard of is kept, not scrubbed.
   *
   * Absence is the default and means CamStack — which is also exactly what the
   * app drew before this setting existed, so a camera merely looked at carries
   * no document.
   *
   * ONE, not a set. This replaced a `clipSources` DENY LIST built for a
   * fan-out surface that was deleted and never regained a reader; the operator
   * settled the opposite contract — *"La sorgente deve essere selezionata lato
   * viewer dall'utente nelle settings generali della camera come provider di
   * quella camera. Mai mischiate provider diversi."* — and `videoclips
   * .listClips` now takes one `provider` at a time.
   *
   * It writes NO server state and claims no authority over whether a provider
   * runs. Sources are not enabled or disabled here: they exist because of a
   * configuration that lives somewhere else (HKSV exists if the camera is
   * exported to HomeKit; the Reolink source exists because Reolink is that
   * camera's provider), and a second knob over somebody else's decision is the
   * failure D62 describes and D557 § 3 rejected by name. This is which one the
   * operator LOOKS at — a viewer preference, an ACCOUNT setting (unlike the
   * stream tier and audio memory in `camera-local-store.ts`).
   */
  readonly clipProvider?: string
  /**
   * Which ONE of this camera's RECORDING sources the timeline reads — the twin
   * of {@link CameraPref.clipProvider}, deliberately a separate axis: a camera
   * whose clips come from the card may still have its continuous bar painted
   * by us, and the operator ruled that recordings default to ours ALWAYS.
   *
   * Absence is that default and means the RESERVED source id `camstack`, which
   * no other addon may mint (D625) — so there is nowhere for a "first row"
   * fallback to creep in and silently swap one camera's coverage for another's.
   *
   * Stores the SOURCE id, like `clipProvider`, not the addonId the cap's
   * `provider` field takes; `data/recording-sources.ts` is the single place
   * that turns one into the other.
   */
  readonly recordingProvider?: string
  /**
   * The operator's LOCAL customisation of this camera's accessory panel —
   * devices added here, their order, names, icons, hidden flags. An ADDITION
   * to the hub's linked devices, never a replacement: the viewer does not
   * write the hub's link set (`accessories/accessory-prefs.ts`). Absent when
   * nothing was customised; an empty document is stored as absence.
   */
  readonly accessories?: CameraAccessoryPrefs
}

/** The full persisted camera-prefs document. */
export interface AppCameraPrefs {
  /** Per-camera overrides, keyed by camera id. */
  readonly byId: Readonly<Record<number, CameraPref>>
  /** Global custom order of camera ids. Cameras absent here keep server order. */
  readonly order: readonly number[]
}

// ── Defaults ───────────────────────────────────────────────────────────────────

/** Sane out-of-the-box prefs. Frozen so a default can never be mutated. */
export const DEFAULTS: AppCameraPrefs = Object.freeze({
  byId: Object.freeze({}) as Readonly<Record<number, CameraPref>>,
  order: Object.freeze([]) as readonly number[],
}) as AppCameraPrefs

/** AsyncStorage key for the persisted camera-prefs document. */
export const CAMERA_PREFS_STORAGE_KEY = '@camstack/v2/camera-prefs'

/** Fresh, mutable copy equal to DEFAULTS (callers may mutate the returned shell). */
export function resetCameraPrefsEntry(): AppCameraPrefs {
  return { byId: {}, order: [] }
}

// ── Pure reducers (unit-tested) ──────────────────────────────────────────────
// Each returns a NEW AppCameraPrefs; none mutate their input (immutability rule).

/** Merge a partial override onto one camera id, dropping the entry entirely when
 *  it ends up empty (no localName + not hidden) to keep the document compact. */
function mergePref(
  prefs: AppCameraPrefs,
  id: number,
  patch: CameraPref,
): AppCameraPrefs {
  const current = prefs.byId[id] ?? {}
  const merged: CameraPref = { ...current, ...patch }
  // Normalise: an empty string name or undefined drops the field.
  const next: {
    localName?: string
    hidden?: boolean
    highlight?: GridHighlightSettings
    overlay?: CameraOverlayConfig
    clipProvider?: string
    recordingProvider?: string
    accessories?: CameraAccessoryPrefs
  } = {}
  if (typeof merged.localName === 'string' && merged.localName.length > 0) {
    next.localName = merged.localName
  }
  if (merged.hidden === true) next.hidden = true
  if (merged.highlight) next.highlight = merged.highlight
  if (typeof merged.clipProvider === 'string' && merged.clipProvider.length > 0) {
    next.clipProvider = merged.clipProvider
  }
  if (typeof merged.recordingProvider === 'string' && merged.recordingProvider.length > 0) {
    next.recordingProvider = merged.recordingProvider
  }
  // A config equal to the defaults is stored as ABSENCE — otherwise every
  // camera the operator merely LOOKED at would carry a document, and a future
  // change to a default would be silently pinned to the old value on all of
  // them.
  if (merged.overlay && !isDefaultOverlay(merged.overlay)) next.overlay = merged.overlay
  // Same rule as `overlay`: a document that says nothing is stored as absence.
  if (merged.accessories && !isEmptyAccessoryPrefs(merged.accessories)) {
    next.accessories = merged.accessories
  }

  const byId: Record<number, CameraPref> = { ...prefs.byId }
  if (Object.keys(next).length === 0) {
    delete byId[id]
  } else {
    byId[id] = next
  }
  return { ...prefs, byId }
}

/** Set (or clear) a camera's local display name. Empty/whitespace clears it. */
export function setLocalNameEntry(
  prefs: AppCameraPrefs,
  id: number,
  name: string,
): AppCameraPrefs {
  const trimmed = name.trim()
  return mergePref(prefs, id, { localName: trimmed.length > 0 ? trimmed : undefined })
}

/** Set (or clear) a camera's hidden flag. */
export function setHiddenEntry(
  prefs: AppCameraPrefs,
  id: number,
  hidden: boolean,
): AppCameraPrefs {
  return mergePref(prefs, id, { hidden: hidden ? true : undefined })
}

/** Replace a camera's per-camera highlight settings. */
export function setCameraHighlightEntry(
  prefs: AppCameraPrefs,
  id: number,
  highlight: GridHighlightSettings,
): AppCameraPrefs {
  return mergePref(prefs, id, { highlight })
}

/**
 * Set (or clear) which ONE source this camera's clip surface reads.
 *
 * `undefined`, empty or blank clears the pick back to the default, and a
 * cleared entry is stored as ABSENCE — a camera the operator merely opened the
 * menu on must not end up carrying a document.
 */
export function setCameraClipProviderEntry(
  prefs: AppCameraPrefs,
  id: number,
  sourceId: string | undefined,
): AppCameraPrefs {
  const trimmed = typeof sourceId === 'string' ? sourceId.trim() : ''
  return mergePref(prefs, id, { clipProvider: trimmed.length > 0 ? trimmed : undefined })
}

/** This camera's stored pick, or undefined when it has never been chosen. */
export function cameraClipProvider(prefs: AppCameraPrefs, id: number): string | undefined {
  return prefs.byId[id]?.clipProvider
}

/**
 * Set (or clear) which ONE source this camera's RECORDING timeline reads.
 *
 * Same contract as {@link setCameraClipProviderEntry}: blank clears back to
 * the default, and a cleared entry is stored as ABSENCE.
 */
export function setCameraRecordingProviderEntry(
  prefs: AppCameraPrefs,
  id: number,
  sourceId: string | undefined,
): AppCameraPrefs {
  const trimmed = typeof sourceId === 'string' ? sourceId.trim() : ''
  return mergePref(prefs, id, { recordingProvider: trimmed.length > 0 ? trimmed : undefined })
}

/** This camera's stored recording pick, or undefined — which MEANS ours. */
export function cameraRecordingProvider(prefs: AppCameraPrefs, id: number): string | undefined {
  return prefs.byId[id]?.recordingProvider
}

/** Replace this camera's overlay document. */
export function setCameraOverlayEntry(
  prefs: AppCameraPrefs,
  id: number,
  overlay: CameraOverlayConfig,
): AppCameraPrefs {
  return mergePref(prefs, id, { overlay })
}

/** This camera's overlay config, defaults filled in. Never undefined — the
 *  caller draws something either way, so "no document" has to mean "defaults"
 *  rather than a branch at every render site. */
export function cameraOverlay(prefs: AppCameraPrefs, id: number): CameraOverlayConfig {
  return prefs.byId[id]?.overlay ?? OVERLAY_DEFAULTS
}

/** This camera's local accessory document, empty when never customised. */
export function cameraAccessoryPrefs(prefs: AppCameraPrefs, id: number): CameraAccessoryPrefs {
  return prefs.byId[id]?.accessories ?? EMPTY_ACCESSORY_PREFS
}

/**
 * Apply one accessory reducer to this camera's local document. The reducer
 * reads the LATEST stored document (never a render-time snapshot), so two
 * rapid edits accumulate — the same reason the timeline-filter toggles
 * resolves its base inside the store.
 */
export function updateCameraAccessoriesEntry(
  prefs: AppCameraPrefs,
  id: number,
  update: (current: CameraAccessoryPrefs) => CameraAccessoryPrefs,
): AppCameraPrefs {
  return mergePref(prefs, id, { accessories: update(cameraAccessoryPrefs(prefs, id)) })
}

/** Replace the global custom order. De-dupes and keeps only finite integers. */
export function setOrderEntry(prefs: AppCameraPrefs, ids: readonly number[]): AppCameraPrefs {
  const seen = new Set<number>()
  const order: number[] = []
  for (const id of ids) {
    if (Number.isInteger(id) && !seen.has(id)) {
      seen.add(id)
      order.push(id)
    }
  }
  return { ...prefs, order }
}

// ── Parsing / validation at the storage boundary ──────────────────────────────

/** Parse a stored highlight blob into a complete settings object (defaults fill
 *  any missing/invalid field), or undefined when it's not an object. */
function parseHighlight(raw: unknown): GridHighlightSettings | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const audio = r.audio === 'sensor' || r.audio === 'level' ? r.audio : 'off'
  return {
    motion: r.motion === true,
    audio,
    audioDb: typeof r.audioDb === 'number' ? r.audioDb : GRID_HIGHLIGHT_DEFAULTS.audioDb,
    audioHoldSec: typeof r.audioHoldSec === 'number' ? r.audioHoldSec : GRID_HIGHLIGHT_DEFAULTS.audioHoldSec,
    detection: r.detection === true,
    detectionHoldSec:
      typeof r.detectionHoldSec === 'number' ? r.detectionHoldSec : GRID_HIGHLIGHT_DEFAULTS.detectionHoldSec,
    detectionClasses: Array.isArray(r.detectionClasses)
      ? r.detectionClasses.filter((c): c is string => typeof c === 'string')
      : [],
    clusterLabel: r.clusterLabel === 'text' ? 'text' : GRID_HIGHLIGHT_DEFAULTS.clusterLabel,
  }
}

function parsePref(raw: unknown): CameraPref | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const next: {
    localName?: string
    hidden?: boolean
    highlight?: GridHighlightSettings
    overlay?: CameraOverlayConfig
    clipProvider?: string
    recordingProvider?: string
    accessories?: CameraAccessoryPrefs
  } = {}
  if (typeof r.localName === 'string' && r.localName.trim().length > 0) {
    next.localName = r.localName.trim()
  }
  if (r.hidden === true) next.hidden = true
  const highlight = parseHighlight(r.highlight)
  if (highlight) next.highlight = highlight
  if (typeof r.clipProvider === 'string' && r.clipProvider.trim().length > 0) {
    next.clipProvider = r.clipProvider.trim()
  }
  if (typeof r.recordingProvider === 'string' && r.recordingProvider.trim().length > 0) {
    next.recordingProvider = r.recordingProvider.trim()
  }
  const overlay = normaliseOverlay(r.overlay)
  if (overlay && !isDefaultOverlay(overlay)) next.overlay = overlay
  const accessories = parseAccessoryPrefs(r.accessories)
  if (accessories !== undefined) next.accessories = accessories
  return Object.keys(next).length > 0 ? next : null
}

/** Parse persisted JSON into a fully-populated `AppCameraPrefs`. Never throws:
 *  unknown/corrupt storage degrades to DEFAULTS; malformed per-camera entries
 *  are dropped, and the order list is sanitised (integers, de-duped). */
export function parseCameraPrefs(raw: string | null): AppCameraPrefs {
  if (!raw) return resetCameraPrefsEntry()
  let data: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return resetCameraPrefsEntry()
    data = parsed as Record<string, unknown>
  } catch {
    return resetCameraPrefsEntry()
  }

  const byId: Record<number, CameraPref> = {}
  const rawById = data.byId
  if (typeof rawById === 'object' && rawById !== null) {
    for (const [key, value] of Object.entries(rawById as Record<string, unknown>)) {
      const id = Number(key)
      if (!Number.isInteger(id)) continue
      const pref = parsePref(value)
      if (pref) byId[id] = pref
    }
  }

  const rawOrder = Array.isArray(data.order) ? (data.order as unknown[]) : []
  const seen = new Set<number>()
  const order: number[] = []
  for (const v of rawOrder) {
    if (typeof v === 'number' && Number.isInteger(v) && !seen.has(v)) {
      seen.add(v)
      order.push(v)
    }
  }

  return { byId, order }
}

// ── zustand store (glue) ─────────────────────────────────────────────────────

interface CameraPrefsState {
  readonly prefs: AppCameraPrefs
  /** True once `hydrate()` has loaded persisted prefs. */
  readonly hydrated: boolean
  /** The hub `prefs` belongs to (`server-scope.ts`); `null` before the first
   *  load. Camera ids are only unique within one hub. */
  readonly serverId: string | null
  hydrate: () => Promise<void>
  setLocalName: (id: number, name: string) => void
  setHidden: (id: number, hidden: boolean) => void
  setCameraHighlight: (id: number, highlight: GridHighlightSettings) => void
  setCameraOverlay: (id: number, overlay: CameraOverlayConfig) => void
  /** Choose which ONE of this camera's clip sources the clip surface reads.
   *  `undefined` clears the pick back to the default (CamStack). */
  setCameraClipProvider: (id: number, sourceId: string | undefined) => void
  /** The same, for the RECORDING timeline's source. */
  setCameraRecordingProvider: (id: number, sourceId: string | undefined) => void
  setOrder: (ids: readonly number[]) => void
  /** Apply one accessory-panel reducer to this camera's local document,
   *  reading the latest stored state (atomic — rapid edits accumulate). */
  updateCameraAccessories: (
    id: number,
    update: (current: CameraAccessoryPrefs) => CameraAccessoryPrefs,
  ) => void
  /** Adopt a document from the account (validated here). */
  applyAccount: (raw: unknown) => void
}

/** Persist the current prefs. Best-effort: a storage failure is logged but never
 *  blocks the in-memory update the user already sees. */
function persist(prefs: AppCameraPrefs): void {
  const serverId = useCameraPrefsStore.getState().serverId
  if (serverId === null) {
    log.warn('prefs', 'camera-prefs write before a hub was bound — kept in memory only')
    return
  }
  void AsyncStorage.setItem(scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, serverId), JSON.stringify(prefs)).catch(
    (e: unknown) => {
      log.error('prefs', 'camera-prefs-store persist failed', { error: e instanceof Error ? e.message : String(e) })
    },
  )
}

export const useCameraPrefsStore = create<CameraPrefsState>((set, get) => ({
  prefs: resetCameraPrefsEntry(),
  hydrated: false,
  serverId: null,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      // The device-local fields this document used to carry are moved out
      // BEFORE it is read (`device-local-migration.ts`), and the document is
      // the ACTIVE HUB's copy (`server-scope.ts`).
      await migrateDeviceLocalOnce()
      const serverId = await whenServerScoped()
      if (get().hydrated) return
      const raw = await AsyncStorage.getItem(scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, serverId))
      set({ prefs: parseCameraPrefs(raw), serverId, hydrated: true })
    } catch (e) {
      log.error('prefs', 'camera-prefs hydrate failed', { error: e instanceof Error ? e.message : String(e) })
      set({ hydrated: true })
    }
  },

  setLocalName: (id, name) => {
    const prefs = setLocalNameEntry(get().prefs, id, name)
    set({ prefs })
    persist(prefs)
  },

  setHidden: (id, hidden) => {
    const prefs = setHiddenEntry(get().prefs, id, hidden)
    set({ prefs })
    persist(prefs)
  },

  setCameraOverlay: (id, overlay) => {
    const prefs = setCameraOverlayEntry(get().prefs, id, overlay)
    set({ prefs })
    persist(prefs)
  },

  setCameraClipProvider: (id, sourceId) => {
    const prefs = setCameraClipProviderEntry(get().prefs, id, sourceId)
    set({ prefs })
    persist(prefs)
  },

  setCameraRecordingProvider: (id, sourceId) => {
    const prefs = setCameraRecordingProviderEntry(get().prefs, id, sourceId)
    set({ prefs })
    persist(prefs)
  },

  updateCameraAccessories: (id, update) => {
    const prefs = updateCameraAccessoriesEntry(get().prefs, id, update)
    set({ prefs })
    persist(prefs)
  },

  setCameraHighlight: (id, highlight) => {
    const prefs = setCameraHighlightEntry(get().prefs, id, highlight)
    set({ prefs })
    persist(prefs)
  },

  setOrder: (ids) => {
    const prefs = setOrderEntry(get().prefs, ids)
    set({ prefs })
    persist(prefs)
  },

  applyAccount: (raw) => {
    const prefs = parseCameraPrefs(JSON.stringify(raw))
    set({ prefs })
    persist(prefs)
  },
}))

// A hub switch swaps the whole document in ONE set, once it is read — so a
// subscriber (the account sync) sees one change carrying the new `serverId`,
// and can tell a switch from an edit.
onServerScopeChange((serverId) => {
  void AsyncStorage.getItem(scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, serverId))
    .then((raw) => useCameraPrefsStore.setState({ prefs: parseCameraPrefs(raw), serverId, hydrated: true }))
    .catch((e: unknown) => {
      log.error('prefs', 'camera-prefs reload failed', { error: e instanceof Error ? e.message : String(e) })
      useCameraPrefsStore.setState({ prefs: resetCameraPrefsEntry(), serverId, hydrated: true })
    })
})
