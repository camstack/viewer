/**
 * grid-store — camstack multi-camera grid persistence (srcV2).
 *
 * A grid is a named, ordered set of camera device ids rendered as an
 * auto-layout wall of live tiles. v1 only supports auto-layout (no manual
 * 12-col drag); the shape is intentionally minimal so it round-trips cleanly
 * through AsyncStorage.
 *
 * Architecture: the mutation logic is a set of *pure* reducers
 * (`createGrid`, `renameGrid`, `setGridCameras`, `deleteGrid`) operating on a
 * `readonly Grid[]` — these are unit-tested in isolation. The zustand store is
 * thin glue: it holds the array, applies a reducer, and persists the result to
 * AsyncStorage. Loading is lazy via `hydrate()` (called once at app start).
 *
 * A grid's DEFINITION is an ACCOUNT setting (per user, per hub; synced as the
 * `viewer.grids` namespace by `account/account-settings-sync.ts`); this list
 * is its local cache, every grid carrying its hub (`Grid.serverId`). How a
 * wall is laid out, sounds and which tier it pulls on THIS device
 * (`layout`, `audioOnIds`, `quality`) live in `grid-local-store.ts`.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '../lib/logger.js'
import {
  canonicalLayers,
  migrateLegacyLayers,
  OVERLAY_LAYERS,
  type OverlayLayer,
} from '../components/camera/overlay/overlay-config.js'
import { migrateDeviceLocalOnce } from './device-local-migration.js'

/**
 * Per-grid display preferences. Each is optional in storage; readers resolve
 * them through {@link resolveGridOptions}, which falls back per field, so older
 * persisted grids keep working.
 *
 * EVERY key here is tri-state on purpose: `undefined` means "this grid has
 * never been asked", which is NOT the same as a stored `false`. The border
 * highlight defaults ON, so collapsing the two would switch it back on for
 * every operator who had deliberately turned it off.
 */
export interface GridOptions {
  /** Overlay the camera name on each tile. */
  readonly showName?: boolean
  /**
   * Master border-highlight switch — the wall's counterpart of the bar's `Zap`
   * button. When on, a tile gets a colored border as soon as one of the grid's
   * enabled {@link GridHighlightSettings} triggers fires.
   *
   * Defaults to ON (see {@link GRID_OPTION_DEFAULTS}): a surveillance wall that
   * does not tell you which camera just moved is the wall doing less than it
   * can. Absent ⇒ on; a stored `false` is the operator's answer and survives.
   */
  readonly highlightOn?: boolean
  /** Show only tiles that are currently "active" (a trigger is lit). */
  readonly activeOnly?: boolean
  /**
   * The box overlay drawn on every tile — the SAME checkable layer set the
   * camera-detail overlay uses. Only the WALL-owned layers are meaningful here
   * (`BAR_LAYERS`: objects / discarded / stationary); the motion layer is each
   * camera's and travels on that camera's own document.
   *
   * Migrated from the retired `boxes: 'off'|'kept'|'all'` scale by
   * {@link resolveGridOptions} — a grid persisted at `'kept'` keeps drawing the
   * survivors AND the parked objects it was drawing, because both rode that
   * one rung.
   */
  readonly layers?: readonly OverlayLayer[]
}

/**
 * A persisted options document as it may actually exist ON DISK: the fields
 * above plus the ones they replaced.
 *
 * `resolveGridOptions` reads storage, and storage still holds grids written
 * before the layer set. Naming the retired fields here — rather than casting
 * the argument to a record at the one call site that needs them — is what lets
 * the migration be type-checked instead of type-asserted.
 */
export interface StoredGridOptions extends GridOptions {
  /**
   * @deprecated moved 2026-10-21 → `grid-local-store` (a DEVICE setting: it
   * depends on the screen). A grid written before the two-level split still
   * carries it until `two-levels-migration.ts` moves it; no reader here looks
   * at it.
   */
  readonly layout?: unknown
  /**
   * @deprecated moved 2026-10-07 → `grid-local-store` (device-local). A grid
   * written before the profile split still carries it until
   * `device-local-migration.ts` moves it on the next launch; no reader here
   * looks at it.
   */
  readonly quality?: unknown
  /** @deprecated retired 2026-08-18 → `layers`. The ordered scale, or the
   *  boolean it was before that. */
  readonly boxes?: 'off' | 'kept' | 'all' | boolean
  /** @deprecated retired 2026-08-18 → `layers`. Never applied to a grid: motion
   *  regions are per-camera and the tile reads them off the camera document. */
  readonly motionBoxes?: boolean
  /** @deprecated retired 2026-08-12 → the `discarded` layer. */
  readonly discardedBoxes?: boolean
}

/**
 * A grid's stream-quality preference.
 *
 * It IS {@link StreamQuality} — the system profile enum plus `auto` — and not a
 * type of its own. There used to be one, `'auto'|'high'|'medium'|'low'`, and
 * `medium` was a word no other part of the system said: the hub speaks
 * `CamProfileSchema` (`high|mid|low`), the settings store already spelled it
 * `mid`, and `quality-target.ts` carried a translation between the two so that
 * nothing downstream had to reconcile them. The operator settled it on
 * 2026-09-02 — one scale, the system's.
 *
 * Re-exported under this name so the grid's own modules keep reading in their
 * own vocabulary. `GridQuality` as a distinct TYPE is gone.
 */
export type { StreamQuality as GridQuality } from './settings-store.js'

/** A grid's wall layout: 'auto' picks the column split that maximizes per-tile
 *  area; a positive integer forces that many columns. */
export type GridLayout = 'auto' | number

/** Audio-highlight trigger mode (mirrors V1): off, binary presence ('sensor'),
 *  or dBFS-level threshold ('level'). */
export type GridAudioHighlightMode = 'off' | 'sensor' | 'level'

/** How a timeline cluster labels its detected kinds: a taxonomy glyph ('icon')
 *  or the translated kind label ('text'). Icon shows the SUB glyph when a
 *  cluster carries a sub-type, else the MACRO glyph; text shows the translated
 *  sub label, else the macro. */
export type GridClusterLabelMode = 'icon' | 'text'

/** Per-grid highlight settings — applied to EVERY camera in the grid (the
 *  grid-mode counterpart of V1's per-camera highlight). A camera's tile gets a
 *  colored border when one of the enabled triggers fires (priority in the embed:
 *  detection > audio > motion). The master on/off is a transient session toggle
 *  in the control bar, NOT stored here. */
export interface GridHighlightSettings {
  /** Border on hardware/ML motion. */
  readonly motion: boolean
  /** Audio trigger: off | presence | dBFS level. */
  readonly audio: GridAudioHighlightMode
  /** dBFS threshold for `audio: 'level'` (negative; e.g. -30). */
  readonly audioDb: number
  /** Keep the audio highlight this many seconds after it drops. */
  readonly audioHoldSec: number
  /** Border on object detection. */
  readonly detection: boolean
  /** Keep the detection highlight this many seconds after it drops. */
  readonly detectionHoldSec: number
  /** Macro classes that trigger the detection highlight; EMPTY = any class. */
  readonly detectionClasses: readonly string[]
  /** How timeline cluster labels render their kinds (icon glyph vs text). */
  readonly clusterLabel: GridClusterLabelMode
}

/** Selectable detection macro classes (from @camstack/types `MacroClass` —
 *  first-level + detail). Empty selection means "any class". */
export const DETECTION_MACRO_CLASSES = ['person', 'vehicle', 'animal', 'face', 'plate'] as const

/** Default per-grid highlight settings (motion-only, like a sane starting point;
 *  inert until the bar's highlight toggle turns it on). */
export const GRID_HIGHLIGHT_DEFAULTS: GridHighlightSettings = {
  motion: true,
  audio: 'off',
  audioDb: -30,
  audioHoldSec: 5,
  detection: false,
  detectionHoldSec: 3,
  detectionClasses: [],
  clusterLabel: 'icon',
}

/** Fill any missing highlight field from defaults (forward-compat for grids /
 *  cameras persisted before a field existed). */
export function withHighlightDefaults(p?: Partial<GridHighlightSettings>): GridHighlightSettings {
  return { ...GRID_HIGHLIGHT_DEFAULTS, ...(p ?? {}) }
}

/** A persisted grid: a name + the ordered camera device ids it shows, plus
 *  per-grid display options. v1 is auto-layout only (no manual 12-col drag);
 *  display order is the `cameraIds` array order (drag-reorder rewrites it). */
export interface Grid {
  readonly id: string
  readonly name: string
  /**
   * The hub this grid belongs to (`ServerConfig.id`). Camera ids are only
   * unique within ONE hub — two hubs both have a camera 101 — so a grid is
   * shown, and its `cameraIds` resolved, only against its own hub. Absent only
   * on a grid written before 2026-10-21, until `server-scope-migration.ts`
   * stamps it; readers treat an absent hub as "not this hub".
   */
  readonly serverId?: string
  /** Camera device ids (server `DeviceInfo.id`), in display order. */
  readonly cameraIds: readonly number[]
  /** Camera device ids hidden from the live wall but still grid members (so they
   *  can be re-shown in the manage view). A subset of `cameraIds`; ids no longer
   *  members are tolerated and ignored by readers. Optional for forward-compat
   *  with older persisted grids (absent ⇒ nothing hidden). */
  readonly hiddenCameraIds?: readonly number[]
  /** Optional per-grid display preferences (name overlay, layout, overlays). */
  readonly options?: GridOptions
  /** Optional per-grid highlight settings (motion/audio/detection triggers). */
  readonly highlight?: GridHighlightSettings
}

/** A grid as it travels through export/import: the persistable fields minus the
 *  volatile `id` (the importer mints a fresh one to avoid collisions) and the
 *  hub (the importer stamps the active one). */
export type ImportedGrid = Omit<Grid, 'id' | 'serverId'>

/** The grids of ONE hub, in stored order. Pure — safe in selectors. */
export function gridsForServer(grids: readonly Grid[], serverId: string | null | undefined): readonly Grid[] {
  if (serverId === null || serverId === undefined) return []
  return grids.filter((g) => g.serverId === serverId)
}

/** One grid by id, only when it belongs to `serverId`. */
export function findServerGrid(
  grids: readonly Grid[],
  gridId: string | null | undefined,
  serverId: string | null | undefined,
): Grid | undefined {
  if (gridId === null || gridId === undefined || serverId === null || serverId === undefined) return undefined
  return grids.find((g) => g.id === gridId && g.serverId === serverId)
}

/** AsyncStorage key for the persisted grid list. */
export const GRIDS_STORAGE_KEY = '@camstack/v2/grids'

/** A grid's options as a wall renders them: the account options resolved, plus
 *  the layout THIS device keeps for it (`grid-local-store`). */
export type ResolvedGridOptions = Required<GridOptions> & { readonly layout: GridLayout }

/** Last-resort display options when a grid's `options` do not supply a field. */
export const GRID_OPTION_DEFAULTS: ResolvedGridOptions = {
  showName: false,
  layout: 'auto',
  highlightOn: true,
  activeOnly: false,
  layers: [],
}

/** Resolve a grid's effective display options, falling back per field to the
 *  built-in constants. `layout` is this device's (`resolveGridLayout` on the
 *  grid's `grid-local` entry). Pure — safe to call from render/selectors. */
export function resolveGridOptions(
  options: StoredGridOptions | undefined,
  layout: GridLayout = GRID_OPTION_DEFAULTS.layout,
): ResolvedGridOptions {
  const defaults = GRID_OPTION_DEFAULTS
  return {
    showName: options?.showName ?? defaults.showName,
    layout,
    // `??` and not `||`: a stored `false` is an answer, not a missing value.
    highlightOn: options?.highlightOn ?? defaults.highlightOn,
    activeOnly: options?.activeOnly ?? defaults.activeOnly,
    // A canonical `layers` is authoritative; a grid stored before the set
    // existed is migrated off its `boxes` rung so the wall keeps drawing what
    // it drew. The motion layer never applies to a grid document — it is
    // per-camera — so it is dropped here rather than silently ignored later.
    layers:
      options === undefined
        ? defaults.layers
        : Array.isArray(options.layers)
          ? canonicalLayers(options.layers).filter((layer) => layer !== 'motion')
          : migrateLegacyLayers(options).filter((layer) => layer !== 'motion'),
  }
}

/** The grid's camera ids that should render on the live wall: members minus the
 *  hidden set, in display order. Pure — safe to call from render/selectors. */
export function visibleGridCameraIds(grid: Grid): readonly number[] {
  if (!grid.hiddenCameraIds || grid.hiddenCameraIds.length === 0) return grid.cameraIds
  const hidden = new Set(grid.hiddenCameraIds)
  return grid.cameraIds.filter((id) => !hidden.has(id))
}

// ── Pure reducers (unit-tested) ──────────────────────────────────────────────
// Each returns a NEW array; none mutate their input (immutability rule).

/** Build a new grid with a generated id. Trims the name, falling back to the
 *  caller-supplied `defaultName` so the list never shows a blank row. The
 *  default is threaded in from the UI layer (i18n'd there) so this store stays
 *  translation-free. */
export function createGridEntry(
  grids: readonly Grid[],
  name: string,
  id: string,
  defaultName: string,
  serverId: string,
): readonly Grid[] {
  const trimmed = name.trim()
  const grid: Grid = { id, name: trimmed || defaultName, serverId, cameraIds: [] }
  return [...grids, grid]
}

/** Rename one grid (no-op if the id is unknown). Empty names are ignored to
 *  avoid blank rows — the caller's prior name is kept. */
export function renameGridEntry(grids: readonly Grid[], id: string, name: string): readonly Grid[] {
  const trimmed = name.trim()
  if (!trimmed) return grids
  return grids.map((g) => (g.id === id ? { ...g, name: trimmed } : g))
}

/** Replace a grid's camera set (deduped, order preserved). Prunes the hidden set
 *  to the surviving members so removed cameras don't linger as ghost-hidden ids. */
export function setGridCamerasEntry(
  grids: readonly Grid[],
  id: string,
  cameraIds: readonly number[],
): readonly Grid[] {
  const deduped = Array.from(new Set(cameraIds))
  const members = new Set(deduped)
  return grids.map((g) =>
    g.id === id ? { ...g, cameraIds: deduped, hiddenCameraIds: pruneHidden(g.hiddenCameraIds, members) } : g,
  )
}

/** Add one camera to a grid (appended last; no-op if already a member). */
export function addGridCameraEntry(
  grids: readonly Grid[],
  id: string,
  cameraId: number,
): readonly Grid[] {
  return grids.map((g) => {
    if (g.id !== id || g.cameraIds.includes(cameraId)) return g
    return { ...g, cameraIds: [...g.cameraIds, cameraId] }
  })
}

/** Remove one camera from a grid (also drops it from the hidden set). */
export function removeGridCameraEntry(
  grids: readonly Grid[],
  id: string,
  cameraId: number,
): readonly Grid[] {
  return grids.map((g) => {
    if (g.id !== id || !g.cameraIds.includes(cameraId)) return g
    const cameraIds = g.cameraIds.filter((c) => c !== cameraId)
    return { ...g, cameraIds, hiddenCameraIds: pruneHidden(g.hiddenCameraIds, new Set(cameraIds)) }
  })
}

/** Hide or show one camera within a grid (no-op for an unknown grid id, or when
 *  hiding a non-member). The hidden set is deduped and kept membership-clean. */
export function setGridCameraHiddenEntry(
  grids: readonly Grid[],
  id: string,
  cameraId: number,
  hidden: boolean,
): readonly Grid[] {
  return grids.map((g) => {
    if (g.id !== id) return g
    const current = new Set(g.hiddenCameraIds ?? [])
    if (hidden) {
      if (!g.cameraIds.includes(cameraId) || current.has(cameraId)) return g
      current.add(cameraId)
    } else {
      if (!current.has(cameraId)) return g
      current.delete(cameraId)
    }
    return { ...g, hiddenCameraIds: g.cameraIds.filter((c) => current.has(c)) }
  })
}

/** Drop any hidden ids that are no longer members; returns `undefined` when the
 *  result is empty so the field stays absent for grids that hide nothing. */
function pruneHidden(
  hidden: readonly number[] | undefined,
  members: ReadonlySet<number>,
): readonly number[] | undefined {
  if (!hidden || hidden.length === 0) return undefined
  const next = hidden.filter((cid) => members.has(cid))
  return next.length > 0 ? next : undefined
}

/** Reorder one grid's cameras to match `order`. Any ids in `order` that are not
 *  current members are ignored; any current members missing from `order` are
 *  appended (defensive — keeps cameras from vanishing on a stale drag payload). */
export function reorderGridCamerasEntry(
  grids: readonly Grid[],
  id: string,
  order: readonly number[],
): readonly Grid[] {
  return grids.map((g) => {
    if (g.id !== id) return g
    const current = new Set(g.cameraIds)
    const seen = new Set<number>()
    const next: number[] = []
    for (const cid of order) {
      if (current.has(cid) && !seen.has(cid)) {
        next.push(cid)
        seen.add(cid)
      }
    }
    for (const cid of g.cameraIds) if (!seen.has(cid)) next.push(cid)
    return { ...g, cameraIds: next }
  })
}

/** Merge per-grid display options (no-op for an unknown id). Existing options
 *  are spread first so a partial patch only overrides the given keys. */
export function setGridOptionsEntry(
  grids: readonly Grid[],
  id: string,
  patch: GridOptions,
): readonly Grid[] {
  return grids.map((g) => (g.id === id ? { ...g, options: { ...g.options, ...patch } } : g))
}

/**
 * Replace ONE hub's grids, keeping every other hub's in place (the account
 * sync's apply path, and a copy from another hub). Each incoming grid is
 * stamped with `serverId`; an id another hub's grid already uses is suffixed
 * with the hub — the same way every time, so applying twice changes nothing.
 */
export function replaceServerGridsEntry(
  grids: readonly Grid[],
  serverId: string,
  incoming: readonly Grid[],
): readonly Grid[] {
  const others = grids.filter((g) => g.serverId !== serverId)
  const takenElsewhere = new Set(others.map((g) => g.id))
  const mine = incoming.map((g) => ({
    ...g,
    id: takenElsewhere.has(g.id) ? `${g.id}@${serverId}` : g.id,
    serverId,
  }))
  return [...others, ...mine]
}

/** One hub's grids as the account document carries them: without the hub
 *  stamp (the account IS per hub). */
export function accountGridsOf(grids: readonly Grid[], serverId: string): readonly Omit<Grid, 'serverId'>[] {
  return gridsForServer(grids, serverId).map(({ serverId: _hub, ...rest }) => {
    if (rest.options === undefined) return rest
    // A grid not yet migrated may still carry the device-level layout; it is
    // never part of the account document.
    const { layout: _layout, ...options }: StoredGridOptions = rest.options
    return { ...rest, options }
  })
}

/** Replace a grid's highlight settings (no-op for an unknown id). */
export function setGridHighlightEntry(
  grids: readonly Grid[],
  id: string,
  highlight: GridHighlightSettings,
): readonly Grid[] {
  return grids.map((g) => (g.id === id ? { ...g, highlight } : g))
}

/** Remove a grid by id. */
export function deleteGridEntry(grids: readonly Grid[], id: string): readonly Grid[] {
  return grids.filter((g) => g.id !== id)
}

/** Parse persisted JSON into a validated `Grid[]` (drops malformed entries).
 *  Never throws — corrupt storage degrades to an empty list. */
export function parseGrids(raw: string | null): readonly Grid[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter(isGrid)
  } catch {
    return []
  }
}

function isGrid(value: unknown): value is Grid {
  if (typeof value !== 'object' || value === null) return false
  const g = value as Record<string, unknown>
  return (
    typeof g.id === 'string' &&
    typeof g.name === 'string' &&
    (g.serverId === undefined || typeof g.serverId === 'string') &&
    Array.isArray(g.cameraIds) &&
    g.cameraIds.every((n) => typeof n === 'number') &&
    isNumberArrayOrUndefined(g.hiddenCameraIds) &&
    isGridOptions(g.options)
  )
}

/** `hiddenCameraIds` is optional; when present it must be a number array. */
function isNumberArrayOrUndefined(value: unknown): boolean {
  if (value === undefined) return true
  return Array.isArray(value) && value.every((n) => typeof n === 'number')
}

/** `options` is optional; when present it must be a plain object whose known
 *  keys (if set) have the right types. Unknown keys are tolerated (forward-compat). */
function isGridOptions(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value !== 'object' || value === null) return false
  const o = value as Record<string, unknown>
  const showNameOk = o.showName === undefined || typeof o.showName === 'boolean'
  // `quality` is deliberately NOT judged here, and that is a fix rather than a
  // relaxation. This guard decides whether the whole GRID parses, so an
  // unrecognised tier used to DELETE the grid — its cameras, its layout, its
  // audio set — at the next launch. That stayed invisible only while the list
  // here and the one in `resolveGridOptions` agreed; the moment the scale
  // changed (`medium` retired, 2026-09-02) every grid an older build had
  // written would have vanished on reopen instead of falling back to `auto`.
  //
  // The operator's rule is normalise-on-read, and the tier now lives in
  // `grid-local-store`, whose parser asks `isStreamQuality`, the one shared
  // list. A shape guard that also judges the VALUE is a second answer to the
  // same question, and this repo has now had five copies of these four words.
  // `layout` is not judged either, for the same reason: it moved to
  // `grid-local-store` (2026-10-21), whose parser validates it.
  const highlightOnOk = o.highlightOn === undefined || typeof o.highlightOn === 'boolean'
  const activeOnlyOk = o.activeOnly === undefined || typeof o.activeOnly === 'boolean'
  // The retired `boxes` rung is still ACCEPTED as INPUT (a document written
  // before the layer set is not corrupt — `resolveGridOptions` migrates it),
  // but it is still VALIDATED: a value outside the three rungs was never
  // written by this app, and a grid carrying one has been tampered with.
  const legacyBoxesOk =
    o.boxes === undefined ||
    typeof o.boxes === 'boolean' ||
    (typeof o.boxes === 'string' && ['off', 'kept', 'all'].includes(o.boxes))
  const layersOk =
    o.layers === undefined ||
    (Array.isArray(o.layers) && o.layers.every((l) => OVERLAY_LAYERS.some((k) => k === l)))
  return showNameOk && highlightOnOk && activeOnlyOk && legacyBoxesOk && layersOk
}

/** A valid persisted `layout`: absent, the literal 'auto', or an integer ≥ 1. */
export function isGridLayout(value: unknown): boolean {
  if (value === undefined || value === 'auto') return true
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
}

// ── id generation ────────────────────────────────────────────────────────────

let idCounter = 0
/** Collision-resistant id without a crypto polyfill (RN runtime has none here):
 *  timestamp + monotonic counter + random suffix. */
export function generateGridId(): string {
  idCounter = (idCounter + 1) % 1_000_000
  return `grid_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

// ── zustand store (glue) ─────────────────────────────────────────────────────

interface GridState {
  readonly grids: readonly Grid[]
  /** True once `hydrate()` has loaded persisted grids (UI can show a spinner). */
  readonly hydrated: boolean
  hydrate: () => Promise<void>
  /** Create a grid. `defaultName` (i18n'd by the caller) is used when `name`
   *  is blank — the store itself carries no translated strings. */
  createGrid: (name: string, defaultName: string, serverId: string) => string
  renameGrid: (id: string, name: string) => void
  setGridCameras: (id: string, cameraIds: readonly number[]) => void
  /** Add one camera to a grid (appended last; no-op if already a member). */
  addGridCamera: (id: string, cameraId: number) => void
  /** Remove one camera from a grid (also drops it from the hidden set). */
  removeGridCamera: (id: string, cameraId: number) => void
  /** Rewrite a grid's camera display order (drag-reorder commit). */
  reorderGridCameras: (id: string, order: readonly number[]) => void
  /** Hide or show one camera within a grid (drops it from / adds it to the live wall). */
  setGridCameraHidden: (id: string, cameraId: number, hidden: boolean) => void
  /** Merge per-grid display options. */
  setGridOptions: (id: string, patch: GridOptions) => void
  /** Replace per-grid highlight settings. */
  setGridHighlight: (id: string, highlight: GridHighlightSettings) => void
  deleteGrid: (id: string) => void
  /** Append parsed grids (each gets a fresh id and `serverId`'s hub) — used by JSON import. */
  importGrids: (grids: readonly ImportedGrid[], serverId: string) => void
  /** Replace one hub's grids with a list from the account (validated here). */
  applyAccountGrids: (serverId: string, raw: unknown) => void
  /** Re-read the list from disk — after `server-scope-migration.ts` stamped it. */
  reload: () => Promise<void>
}

/** Persist the current list. Best-effort: a storage failure is logged but never
 *  blocks the in-memory update the user already sees. */
function persist(grids: readonly Grid[]): void {
  void AsyncStorage.setItem(GRIDS_STORAGE_KEY, JSON.stringify(grids)).catch((e: unknown) => {
    log.error('grids', 'grid-store persist failed', { error: e instanceof Error ? e.message : String(e) })
  })
}

export const useGridStore = create<GridState>((set, get) => ({
  grids: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      // The device-local fields grids used to carry are moved out BEFORE the
      // list is read (`device-local-migration.ts`).
      await migrateDeviceLocalOnce()
      const raw = await AsyncStorage.getItem(GRIDS_STORAGE_KEY)
      set({ grids: parseGrids(raw), hydrated: true })
    } catch (e) {
      log.error('grids', 'grid-store hydrate failed', { error: e instanceof Error ? e.message : String(e) })
      set({ hydrated: true })
    }
  },

  createGrid: (name, defaultName, serverId) => {
    const id = generateGridId()
    const grids = createGridEntry(get().grids, name, id, defaultName, serverId)
    set({ grids })
    persist(grids)
    return id
  },

  renameGrid: (id, name) => {
    const grids = renameGridEntry(get().grids, id, name)
    set({ grids })
    persist(grids)
  },

  setGridCameras: (id, cameraIds) => {
    const grids = setGridCamerasEntry(get().grids, id, cameraIds)
    set({ grids })
    persist(grids)
  },

  addGridCamera: (id, cameraId) => {
    const grids = addGridCameraEntry(get().grids, id, cameraId)
    set({ grids })
    persist(grids)
  },

  removeGridCamera: (id, cameraId) => {
    const grids = removeGridCameraEntry(get().grids, id, cameraId)
    set({ grids })
    persist(grids)
  },

  reorderGridCameras: (id, order) => {
    const grids = reorderGridCamerasEntry(get().grids, id, order)
    set({ grids })
    persist(grids)
  },

  setGridCameraHidden: (id, cameraId, hidden) => {
    const grids = setGridCameraHiddenEntry(get().grids, id, cameraId, hidden)
    set({ grids })
    persist(grids)
  },

  setGridOptions: (id, patch) => {
    const grids = setGridOptionsEntry(get().grids, id, patch)
    set({ grids })
    persist(grids)
  },

  setGridHighlight: (id, highlight) => {
    const grids = setGridHighlightEntry(get().grids, id, highlight)
    set({ grids })
    persist(grids)
  },

  deleteGrid: (id) => {
    const grids = deleteGridEntry(get().grids, id)
    set({ grids })
    persist(grids)
  },

  importGrids: (incoming, serverId) => {
    if (incoming.length === 0) return
    const minted: Grid[] = incoming.map((g) => ({ ...g, id: generateGridId(), serverId }))
    const grids = [...get().grids, ...minted]
    set({ grids })
    persist(grids)
  },

  applyAccountGrids: (serverId, raw) => {
    const incoming = Array.isArray(raw) ? parseGrids(JSON.stringify(raw)) : []
    const grids = replaceServerGridsEntry(get().grids, serverId, incoming)
    set({ grids })
    persist(grids)
  },

  reload: async () => {
    try {
      const raw = await AsyncStorage.getItem(GRIDS_STORAGE_KEY)
      set({ grids: parseGrids(raw), hydrated: true })
    } catch (e) {
      log.error('grids', 'grid-store reload failed', { error: e instanceof Error ? e.message : String(e) })
    }
  },
}))
