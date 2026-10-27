/**
 * settings-store — camstack app preferences persistence (srcV2).
 *
 * Holds user-tunable DEFAULTS that other features consume: how grids render
 * (names/state badges, columns, stream quality, ordering), how a camera opens
 * (autoplay, audio, snapshot refresh). Theme + language live in their own
 * providers; this store stays orthogonal to them.
 *
 * TWO LEVELS (operator decision 2026-10-21), declared field by field in
 * `settings-levels.ts`: the DEVICE half (screen-, network- and
 * hardware-dependent choices) is persisted once per install under
 * {@link SETTINGS_STORAGE_KEY}; the ACCOUNT half is persisted per hub under
 * `${SETTINGS_ACCOUNT_STORAGE_KEY}@<serverId>` — the local cache of the
 * account copy the hub keeps (`account/account-settings-sync.ts`). In memory
 * the two halves are ONE document, so a consumer never asks which level a
 * field is at. Debug mode lives in `device-settings-store.ts`.
 *
 * Architecture mirrors grid-store: the mutation logic is a set of *pure*,
 * immutable reducers operating on a `readonly AppSettings` — these are unit
 * tested in isolation. The zustand store is thin glue that holds the value,
 * applies a reducer, and persists the result to AsyncStorage. Loading is lazy
 * via `hydrate()` (called once at app start).
 */
import { create } from 'zustand'
import { CamProfileSchema } from '@camstack/types/client'
import type { CamProfile } from '@camstack/types'
import { log } from '../lib/logger.js'
import { TILE_LABEL_MODES, isTileLabelMode, type TileLabelMode } from '../../shared/events/events-tile-display.js'
import {
  TOOLBAR_DENSITY_FACTOR,
  type ToolbarDensity,
} from '../components/camera/theater/timeline-scale-tokens.js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { HAPTICS_DEFAULTS, type HapticsConfig } from '../lib/event-haptics.js'
// Pure vocabulary module (no React) — the nine-value overlay position space.
import {
  isOverlayPosition,
  type OverlayPosition,
} from '../components/camera/overlay/overlay-position.js'
// Pure vocabulary module (no React) — how a camera's sound starts, and the
// migration off the boolean this field used to be.
import {
  AUDIO_ON_OPEN_DEFAULT,
  parseAudioOnOpen,
  type AudioOnOpenMode,
} from '../live/audio-on-open.js'
import {
  DEFAULT_TIMELINE_DOCK,
  isTimelineDock,
  type TimelineDock,
} from '../components/camera/theater/timeline-dock.js'
import { migrateDeviceLocalOnce } from './device-local-migration.js'
import { joinSettingsLevels, pickSettingsLevel } from './settings-levels.js'
import { onServerScopeChange, scopedStorageKey, whenServerScoped } from './server-scope.js'

/** Narrow an unknown persisted value to a density the app still offers. */
function isToolbarDensity(raw: unknown): raw is ToolbarDensity {
  return typeof raw === 'string' && raw in TOOLBAR_DENSITY_FACTOR
}

// ── Domain types ──────────────────────────────────────────────────────────────

/**
 * A stream PROFILE, as the whole system spells it.
 *
 * Not a local union: it is `CamProfileSchema` in `@camstack/types`
 * (`z.enum(['high','mid','low'])`), the enum the hub uses in `stream-selection`,
 * `stream-broker.cap`, `snapshot.cap` and `streamProbe`. Aliasing it here — and
 * NOT redeclaring it — is what makes a divergence a type error rather than a
 * word that quietly means the same thing in two spellings.
 *
 * A local spelling is exactly what this replaces: the grid carried
 * `'auto'|'high'|'medium'|'low'` while the settings store carried
 * `'auto'|'high'|'mid'|'low'`, and `quality-target.ts` translated between them
 * on the way to the broker. `medium` was never a system word.
 */
export type StreamProfile = CamProfile

/**
 * A quality PREFERENCE: a system profile, or "you pick".
 *
 * `auto` is deliberately outside {@link StreamProfile} rather than an extra
 * member of it. It is not a tier the broker can be asked for — it is the
 * absence of a request, mapped to `{ kind: 'adaptive' }` by
 * `live/quality-target.ts` — and a system enum that carried it would have to be
 * narrowed again at every boundary that sends a profile on the wire.
 */
export type StreamQuality = 'auto' | StreamProfile

/** Grid rendering defaults (consumed by the grid/tile features). */
export interface GridDefaults {
  /** Motion-highlight linger, in seconds: keep a tile's motion highlight lit
   *  this many seconds AFTER motion stops (it stays lit the whole time motion is
   *  active regardless). 0 = clear the instant motion ends. Applied to every
   *  motion indicator (grid tile / card / detail) via `useMotionHighlight`. */
  readonly motionHoldSec: number
}

/** Single-camera / stream-open defaults (consumed by the camera detail feature). */
export interface StreamDefaults {
  /**
   * What a camera's sound does the instant it opens: always on, always off, or
   * the way THIS camera was left (`last-selected`, the default).
   *
   * Was a boolean until 2026-09-15; `parseAudioOnOpen` migrates a persisted
   * one without moving anybody's answer. The per-camera memory the
   * `last-selected` mode reads lives in `camera-local` (`CameraLocal.audioOn`),
   * beside `quality` — this field is only the MODE, an account setting,
   * while the memory stays on the device.
   */
  readonly audioOnOpen: AudioOnOpenMode
  /** Pinch-to-zoom also grows the stream box taller (up to 50% of the page).
   *  Off by default — when on, the box crops the side edges of a 16:9 frame as
   *  it grows past 16:9 (no black bars). */
  readonly pinchExpandsHeight: boolean
  /**
   * Keep the app's main navigation (Cameras / Library / Grids / Settings) on
   * screen while a single camera is open.
   *
   * The camera detail is a stacked route painted OVER the tabs, so the bottom
   * bar is covered — on a wide window the screen already mounts `SideNavRail`
   * itself, on a phone there was nothing. OFF by default, which is exactly
   * today's behaviour. See `screens/camera-detail/stream-nav-bar.ts` for where
   * it does and does not apply.
   */
  readonly navBarOnStream: boolean
  /**
   * Reopen the last camera the operator was WATCHING when the app next starts.
   *
   * The remembered camera survives only if the single stream was the last place
   * they were: changing page clears it (`navigation/last-camera.ts`). A camera
   * that no longer exists, or one that has been disabled, degrades to the
   * normal launch — never to a broken screen. OFF by default.
   */
  readonly reopenLastCamera: boolean
  /**
   * How tall the single-camera player's toolbar is.
   *
   * `small` is what shipped and stays the default — nobody's toolbar changes
   * until they ask. The choice multiplies the width-derived scale that already
   * sizes every element of the bar (`timeline-scale-tokens.ts`), so the
   * contents grow WITH it instead of a taller bar holding the same small
   * controls; and because it multiplies rather than replaces, a narrow drawer
   * still shrinks the bar at every setting.
   */
  readonly toolbarDensity: ToolbarDensity
  /**
   * Where the timeline sits when the stream is full screen in landscape: off,
   * over the stream, or beside it (`timeline-dock.ts`). The last choice is
   * remembered on this device — the screen it suits depends on the phone.
   */
  readonly landscapeTimeline: TimelineDock
  /**
   * At the end of a clip, play it again from the start.
   *
   * ON by default, at the operator's request in as many words (*"un pulsante
   * di loop nella playback bar, default true, che riproduce in loop la stessa
   * clip alla fine"*, 2026-09-23). It is a per-OPERATOR answer, not a
   * per-camera one — nothing about a camera decides whether watching a clip
   * twice is useful — which is why it sits here and not in `camera-prefs`
   * beside `quality`.
   *
   * The switch is in the playback bar, where the looping happens; there is no
   * Settings row for it. What it costs is in `clips/clip-loop.ts`: one fresh
   * dial per iteration, which on a single-replay-slot camera is that camera's
   * scarcest resource.
   */
  readonly clipLoop: boolean
}

/**
 * Camera-LIST overlays — what each card on the cameras page draws over its
 * thumbnail, and where. GLOBAL (one list, one look), which is why it lives in
 * this store and not in the per-camera overlay document.
 *
 * ONLY the overlays the list already pays for are configurable: the occupancy
 * strip (one poll per card at the 5-minute reconcile) and the motion ring (one
 * low-rate event subscription per card). Turning either OFF drops its cost.
 * The detail screen's other overlays — detection boxes, motion regions, the
 * audio meter, pinned readouts — are deliberately NOT offered here: each is a
 * per-frame event stream or an extra per-device poll, multiplied by every card
 * (measured 2026-08-02: the full set would re-create the ~8 req/s idle storm
 * the list was just cured of). They can join once fed by a batched aggregate.
 */
export interface CameraListOverlaySettings {
  /** The pulsing motion ring around a card while motion (with linger) is live. */
  readonly motionBorder: boolean
  /** The transient "motion" pill on the thumbnail: an anchor, or `off`. Rides
   *  the SAME motion subscription as the ring, so offering it costs nothing —
   *  the subscription opens when either of the two is on. */
  readonly motionBadge: OverlayPosition
  /** Occupancy strip anchor on the thumbnail, or `off` to hide it (also stops
   *  the per-card occupancy poll). */
  readonly occupancy: OverlayPosition
}

/** Global highlight appearance — the border color per trigger type + a shared
 *  thickness. Applied to the grid embed borders AND the single-camera detail
 *  border. (V1 had per-type color + thickness; we keep per-type color + one
 *  shared thickness.) */
export interface HighlightAppearance {
  readonly motionColor: string
  readonly audioColor: string
  readonly detectionColor: string
  /** Border width in px (1–8). */
  readonly thickness: number
}

/** Cluster display preferences for the theater timeline event sequence.
 *  Controls the cluster-card spacing, indicator position and what each item
 *  shows (importance / class badges).
 *  (The `activityVariant` ribbon style, the `repPriority` detection-priority
 *  list and the `minImportance` filter were retired — lanes is the only
 *  activity bar, the representative order is a fixed constant and no surface
 *  filters by importance any more; old persisted blobs are parsed
 *  tolerantly.) */
export interface ClusterPreferences {
  /** Gap between adjacent cluster cards, as a percentage of the (fixed 16:9)
   *  card height. */
  readonly gapPercent: number
  /** Cluster card width as a fraction of the timeline list width (the 16:9 card
   *  height — and therefore the clustering absorption window — follows it). */
  readonly cardWidthFraction: number
  /** Show the detection-class pills on sequence items. */
  readonly showClass: boolean
}

/** Reel thumbnail size preset (events "Recent" reel). Maps to a px edge via
 *  {@link reelThumbSizePx}. `small` is the default — a compact strip that packs
 *  more tracks on screen; `large` restores the pre-resize tile. */
export type ReelThumbSize = 'small' | 'medium' | 'large'

/** Events-page grid density preset: how tightly the track tiles pack. Maps to a
 *  target tile edge via {@link GRID_DENSITY_TILE_PX}; the page derives its
 *  responsive column count from the measured container width
 *  ({@link densityColumns}). */
export type GridDensity = 'compact' | 'medium' | 'large'

/** How label chips render on reel / gallery tiles (one model with the events embed). */
export type { TileLabelMode }

/** Events-surface preferences (the "Recent" reel + events page). */
export interface EventsPreferences {
  /** Reel tile edge preset (S/M/L → px). Drives {@link TrackReel} `cardWidth`. */
  readonly reelThumbSize: ReelThumbSize
  /**
   * One-shot migration stamp for {@link REEL_THUMB_SIZE_PX} rescale. Documents
   * below rev 2 had 80/106/132 px at small/medium/large; they are bumped one
   * preset so the on-screen size stays similar after the scale moves to
   * 60/80/106.
   */
  readonly reelThumbSizeRev: number
  /** Events-page grid density (page-inline control). */
  readonly gridDensity: GridDensity
  /** Reel item label chips: off, icon-only capsule, or icon + text. */
  readonly reelLabelMode: TileLabelMode
  /**
   * One-shot migration stamp. Documents below rev 1 still carry the old
   * "labels on" defaults and are flipped to the bare reel on parse. After
   * the rev, the operator's choice is honoured.
   */
  readonly reelChromeRev: number
  /** Events-page track card label chips. */
  readonly tileLabelMode: TileLabelMode
  /**
   * The details block UNDER each tile — camera name and zone. Both OFF
   * by default: the gallery is a uniform grid of pictures with their chips on
   * them, and a caption line under every tile is an opt-in to a denser,
   * information-first page.
   */
  readonly tileDetailCamera: boolean
  readonly tileDetailZone: boolean
}

/**
 * What the review pages' tiles (People, Plates) say besides the picture and
 * the name: the capture time (a corner chip) and the camera (on the image's
 * bottom edge). Chosen per page from the page's display menu (the eye).
 * Default: the time only — the camera is an opt-in, as on the events tiles.
 */
export interface ReviewPagePreferences {
  readonly facesShowDate: boolean
  readonly facesShowCamera: boolean
  readonly platesShowDate: boolean
  readonly platesShowCamera: boolean
}

/** The full persisted settings document. */
export interface AppSettings {
  readonly grid: GridDefaults
  readonly stream: StreamDefaults
  readonly highlight: HighlightAppearance
  readonly clusters: ClusterPreferences
  readonly events: EventsPreferences
  /** The People and Plates tiles' optional details. */
  readonly review: ReviewPagePreferences
  /** What the camera-list cards draw over their thumbnails (global). */
  readonly cameraList: CameraListOverlaySettings
  /**
   * Device-information pill (local clock, phone battery, internet signal) on the
   * single-camera player and the grid wall. Global (one device), not per-camera.
   * Default `off` (since 1.0.601; a stored choice is kept — no migration); `off` hides it. Persisted before 1.0.599 as `hostBattery`
   * — {@link parseDeviceInfoPosition} still reads that key.
   */
  readonly deviceInfo: OverlayPosition
  /** Vibration. Two independent functions in one slice: PRESS feedback
   *  (`uiFeedback`, opt-out — the sole authority every button funnels through,
   *  see `lib/haptics.ts`) and passive EVENT pulses (`enabled` + per-kind,
   *  opt-in, see `lib/event-haptics.ts`). */
  readonly haptics: HapticsConfig
}

// ── Validation bounds (clamp numeric inputs to sane ranges) ────────────────────

export const COLUMNS_MIN = 1
export const COLUMNS_MAX = 6

/** Every accepted value, at the storage boundary. Built from the SYSTEM enum
 *  plus `auto`, so a profile added upstream cannot be silently unaccepted
 *  here. */
const STREAM_QUALITIES: readonly StreamQuality[] = ['auto', ...CamProfileSchema.options]

/** The selectable reel-thumbnail presets, in ascending size order. */
export const REEL_THUMB_SIZES: readonly ReelThumbSize[] = ['small', 'medium', 'large']

/** Current {@link reelThumbSizePx} scale revision — bump when the px map changes. */
export const REEL_THUMB_SIZE_REV = 2

/**
 * Px edge for each reel-thumbnail preset. `small` (60) is the default compact
 * strip; `large` (106) is the former medium preset after the one-step downscale.
 */
export const REEL_THUMB_SIZE_PX: Readonly<Record<ReelThumbSize, number>> = Object.freeze({
  small: 60,
  medium: 80,
  large: 106,
})

/** Resolve a reel-thumbnail preset to its px edge (also the reel tile height,
 *  since tiles are square). Unknown values fall back to the `small` preset. */
export function reelThumbSizePx(size: ReelThumbSize): number {
  return REEL_THUMB_SIZE_PX[size] ?? REEL_THUMB_SIZE_PX.small
}

/** The selectable events-grid density presets, in ascending tile-size order. */
export const GRID_DENSITIES: readonly GridDensity[] = ['compact', 'medium', 'large']

/** The selectable label modes for reel and gallery tiles. */
export { TILE_LABEL_MODES, isTileLabelMode }

/** Target tile edge (px) per density preset — the responsive column count is
 *  derived from it: `columns ≈ containerWidth / target`. Compact packs the most
 *  tracks per screen; large favours bigger crops. */
export const GRID_DENSITY_TILE_PX: Readonly<Record<GridDensity, number>> = Object.freeze({
  compact: 104,
  medium: 148,
  large: 200,
})

/**
 * Responsive column count for the events track grid: how many tiles of the
 * density's target edge fit the container width. Pure — width injected — and
 * always ≥ 1 (tiny/invalid widths degrade to a single column, never 0/NaN).
 */
export function densityColumns(containerWidth: number, density: GridDensity): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 1
  const target = GRID_DENSITY_TILE_PX[density] ?? GRID_DENSITY_TILE_PX.medium
  return Math.max(1, Math.floor(containerWidth / target))
}

/** Device class for the events gallery. Keyed on the SHORTEST side so a phone
 *  in landscape is still a phone (same rule as the sidebar). */
export type GalleryDeviceClass = 'phone' | 'tablet' | 'desktop'

export const GALLERY_TABLET_MIN_SIDE = 768
export const GALLERY_DESKTOP_MIN_SIDE = 1100
export const GALLERY_COLUMNS_MAX = 12

/** Target tile edge (px) per device × density. The gallery is a uniform square
 *  grid with 2 px gaps, so the numbers are chosen for the COLUMN COUNT they
 *  yield: a 390 pt phone lands on 5 / 4 / 3 (4 is the default — the Photos
 *  grid), tablets and desktops get a larger tile so the same preset does not
 *  explode into postage stamps. Width then decides how many fit. */
export const GALLERY_TILE_PX: Readonly<
  Record<GalleryDeviceClass, Readonly<Record<GridDensity, number>>>
> = Object.freeze({
  phone: { compact: 72, medium: 96, large: 130 },
  tablet: { compact: 110, medium: 140, large: 190 },
  desktop: { compact: 120, medium: 150, large: 200 },
})

export function galleryDeviceClass(minSide: number | undefined): GalleryDeviceClass {
  if (!Number.isFinite(minSide) || (minSide ?? 0) < GALLERY_TABLET_MIN_SIDE) return 'phone'
  if ((minSide ?? 0) < GALLERY_DESKTOP_MIN_SIDE) return 'tablet'
  return 'desktop'
}

/**
 * Events gallery columns: device class picks the tile target, available
 * width picks how many fit. Phone 390 → 5/4/3; extra landscape width
 * grows the count; never 0 and never above the embed schema cap (12).
 */
export function galleryColumns(
  containerWidth: number,
  density: GridDensity,
  device: GalleryDeviceClass,
): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 1
  const target = GALLERY_TILE_PX[device][density] ?? GALLERY_TILE_PX.phone.medium
  return Math.max(1, Math.min(GALLERY_COLUMNS_MAX, Math.floor(containerWidth / target)))
}

/** Selectable motion-highlight linger values, in seconds. `0` = no linger
 *  (clear the instant motion ends). Offered as discrete choices in Settings. */
export const MOTION_HOLD_SECONDS: readonly number[] = [0, 2, 3, 5, 8]
/** Motion linger bounds (seconds). */
export const MOTION_HOLD_MIN = 0
export const MOTION_HOLD_MAX = 30

/** Clamp a motion-highlight linger (seconds) to the supported range, rounding
 *  to an integer; non-finite → the default. */
export function clampMotionHoldSec(value: number): number {
  if (!Number.isFinite(value)) return DEFAULTS.grid.motionHoldSec
  return Math.min(MOTION_HOLD_MAX, Math.max(MOTION_HOLD_MIN, Math.round(value)))
}

/** Default column count for a fixed-layout grid (used by the per-grid layout
 *  picker; column count is a PER-GRID option, not a global setting). */
export const DEFAULT_COLUMNS = 2

/** Clamp the grid column count to the supported range, flooring to an integer. */
export function clampColumns(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_COLUMNS
  const n = Math.floor(value)
  return Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, n))
}

// ── Defaults ───────────────────────────────────────────────────────────────────

/** Sane out-of-the-box settings. Frozen so a default can never be mutated. */
export const DEFAULTS: AppSettings = Object.freeze({
  grid: Object.freeze({
    motionHoldSec: 3,
  }) as GridDefaults,
  stream: Object.freeze({
    // `last-selected` since 2026-09-15, at the operator's request. Sound was
    // made ON on 2026-09-13 because opening a camera and hearing nothing until
    // you find the mute button is the wrong default for a system whose audio
    // detection is one of the things it is watching for — but one answer for
    // every camera was the wrong shape for that. A camera now opens the way it
    // was left, and a camera nobody has chosen on yet opens silent
    // (`opensMuted`).
    audioOnOpen: AUDIO_ON_OPEN_DEFAULT,
    pinchExpandsHeight: false,
    navBarOnStream: false,
    reopenLastCamera: false,
    // Medium, by operator decision (2026-09-04): `small` is the size the
    // toolbar had before the setting existed, and it was chosen as the default
    // only because it changed nothing — which is not a reason.
    toolbarDensity: 'medium',
    landscapeTimeline: DEFAULT_TIMELINE_DOCK,
    // The operator named this default: ON.
    clipLoop: true,
  }) as StreamDefaults,
  highlight: Object.freeze({
    motionColor: '#DC2626', // ui-check-ok: default value of a user-picked colour
    audioColor: '#3B82F6', // ui-check-ok: default value of a user-picked colour
    detectionColor: '#22C55E', // ui-check-ok: default value of a user-picked colour
    thickness: 3,
  }) as HighlightAppearance,
  clusters: Object.freeze({
    gapPercent: 10,
    // Matches the (remapped) medium density preset — keep in sync with
    // TIMELINE_DENSITY_PRESETS.medium so the out-of-box view resolves to Medium.
    cardWidthFraction: 0.6,
    showClass: true,
  }) as ClusterPreferences,
  events: Object.freeze({
    reelThumbSize: 'small',
    reelThumbSizeRev: REEL_THUMB_SIZE_REV,
    gridDensity: 'medium',
    reelLabelMode: 'off',
    reelChromeRev: 1,
    tileLabelMode: 'icon',
    tileDetailCamera: false,
    tileDetailZone: false,
  }) as EventsPreferences,
  review: Object.freeze({
    facesShowDate: true,
    facesShowCamera: false,
    platesShowDate: true,
    platesShowCamera: false,
  }) as ReviewPagePreferences,
  // Opt-in (master off) but every kind pre-armed — see HAPTICS_DEFAULTS.
  haptics: Object.freeze({ ...HAPTICS_DEFAULTS }) as HapticsConfig,
  // Ring on (it replaced the pill). Occupancy off until the operator places
  // it — same default as the player / grid overlay.
  cameraList: Object.freeze({
    motionBorder: true,
    motionBadge: 'off',
    occupancy: 'off',
  }) as CameraListOverlaySettings,
  deviceInfo: 'off',
}) as AppSettings

/** AsyncStorage key of the DEVICE half of the settings document. */
export const SETTINGS_STORAGE_KEY = '@camstack/v2/settings'

/** AsyncStorage base key of the ACCOUNT half — one copy per hub
 *  (`scopedStorageKey`), the local cache of the account document. */
export const SETTINGS_ACCOUNT_STORAGE_KEY = '@camstack/v2/settings-account'

// ── Pure reducers (unit-tested) ──────────────────────────────────────────────
// Each returns a NEW AppSettings; none mutate their input (immutability rule).

/** Update one `GridDefaults` field, validating/clamping where needed. */
export function setGridDefaultEntry<K extends keyof GridDefaults>(
  settings: AppSettings,
  key: K,
  value: GridDefaults[K],
): AppSettings {
  const next =
    key === 'motionHoldSec'
      ? (clampMotionHoldSec(value as number) as GridDefaults[K])
      : value
  return { ...settings, grid: { ...settings.grid, [key]: next } }
}

/** Update one `StreamDefaults` field. */
export function setStreamDefaultEntry<K extends keyof StreamDefaults>(
  settings: AppSettings,
  key: K,
  value: StreamDefaults[K],
): AppSettings {
  return { ...settings, stream: { ...settings.stream, [key]: value } }
}

export const THICKNESS_MIN = 1
export const THICKNESS_MAX = 8

/** Clamp a highlight border thickness to [MIN, MAX], flooring to an integer. */
export function clampThickness(value: number): number {
  if (!Number.isFinite(value)) return DEFAULTS.highlight.thickness
  return Math.min(THICKNESS_MAX, Math.max(THICKNESS_MIN, Math.floor(value)))
}

/** Update one `HighlightAppearance` field (clamps thickness). */
export function setHighlightAppearanceEntry<K extends keyof HighlightAppearance>(
  settings: AppSettings,
  key: K,
  value: HighlightAppearance[K],
): AppSettings {
  const next = key === 'thickness' ? (clampThickness(value as number) as HighlightAppearance[K]) : value
  return { ...settings, highlight: { ...settings.highlight, [key]: next } }
}

export const CARD_WIDTH_FRACTION_MIN = 0.4
export const CARD_WIDTH_FRACTION_MAX = 0.9

/** Clamp the cluster-card width fraction to [MIN, MAX], rounding to two
 *  decimals (keeps preset matching + the percent stepper exact); non-finite →
 *  default. */
export function clampCardWidthFraction(value: number): number {
  if (!Number.isFinite(value)) return DEFAULTS.clusters.cardWidthFraction
  const clamped = Math.min(CARD_WIDTH_FRACTION_MAX, Math.max(CARD_WIDTH_FRACTION_MIN, value))
  return Math.round(clamped * 100) / 100
}

/** Update one `ClusterPreferences` field (immutable, clamps numeric fields). */
export function setClusterEntry<K extends keyof ClusterPreferences>(
  settings: AppSettings,
  key: K,
  value: ClusterPreferences[K],
): AppSettings {
  const next =
    key === 'cardWidthFraction'
      ? (clampCardWidthFraction(value as number) as ClusterPreferences[K])
      : value
  return { ...settings, clusters: { ...settings.clusters, [key]: next } }
}

// ── Timeline density presets (gap + card size pairs) ──────────────────────────

/** The named density presets offered in the camera view-options menu. */
export type TimelineDensityPreset = 'compact' | 'medium' | 'wide'

/** The cluster fields a density preset drives. */
export interface TimelineDensityValues {
  readonly gapPercent: number
  readonly cardWidthFraction: number
}

export const TIMELINE_DENSITY_PRESETS: Readonly<
  Record<TimelineDensityPreset, TimelineDensityValues>
> = Object.freeze({
  // Operator remap (2026-07-17): the old Medium card size felt like a Large, so
  // the ladder shifted down one notch. Large now = the old Medium card size
  // (0.72); Compact dropped a touch below the old Compact (0.55 → 0.48); Medium
  // is the midpoint of the new Compact/Large (0.48↔0.72 → 0.60). The old Wide
  // 0.85 is retired. Keys are unchanged, so persistence still resolves. Only the
  // card-size values move — the per-preset gap spread is untouched.
  compact: Object.freeze({ gapPercent: 2, cardWidthFraction: 0.48 }) as TimelineDensityValues,
  medium: Object.freeze({ gapPercent: 10, cardWidthFraction: 0.6 }) as TimelineDensityValues,
  wide: Object.freeze({ gapPercent: 22, cardWidthFraction: 0.72 }) as TimelineDensityValues,
})

/** The selectable presets, in ascending density order. */
export const TIMELINE_DENSITY_PRESET_ORDER: readonly TimelineDensityPreset[] = [
  'compact',
  'medium',
  'wide',
]

/** Fraction tolerance for preset matching (survives float round-trips). */
const DENSITY_MATCH_EPSILON = 0.001

/** The preset the stored pair matches, or null when the operator holds a
 *  custom combination (set via the fine steppers in Settings → Timeline). */
export function matchTimelineDensityPreset(
  clusters: Pick<ClusterPreferences, 'gapPercent' | 'cardWidthFraction'>,
): TimelineDensityPreset | null {
  for (const preset of TIMELINE_DENSITY_PRESET_ORDER) {
    const v = TIMELINE_DENSITY_PRESETS[preset]
    if (
      Math.abs(clusters.gapPercent - v.gapPercent) < DENSITY_MATCH_EPSILON &&
      Math.abs(clusters.cardWidthFraction - v.cardWidthFraction) < DENSITY_MATCH_EPSILON
    ) {
      return preset
    }
  }
  return null
}

/** Update one `EventsPreferences` field. */
export function setEventsEntry<K extends keyof EventsPreferences>(
  settings: AppSettings,
  key: K,
  value: EventsPreferences[K],
): AppSettings {
  return { ...settings, events: { ...settings.events, [key]: value } }
}

/** Update one `ReviewPagePreferences` field. */
export function setReviewEntry<K extends keyof ReviewPagePreferences>(
  settings: AppSettings,
  key: K,
  value: ReviewPagePreferences[K],
): AppSettings {
  return { ...settings, review: { ...settings.review, [key]: value } }
}

/** Update one `CameraListOverlaySettings` field. */
export function setCameraListEntry<K extends keyof CameraListOverlaySettings>(
  settings: AppSettings,
  key: K,
  value: CameraListOverlaySettings[K],
): AppSettings {
  return { ...settings, cameraList: { ...settings.cameraList, [key]: value } }
}

/** Update the device-information overlay position (global). */
export function setDeviceInfoEntry(
  settings: AppSettings,
  value: OverlayPosition,
): AppSettings {
  return { ...settings, deviceInfo: value }
}

/** Update one `HapticsConfig` flag (all fields are booleans). */
export function setHapticsEntry<K extends keyof HapticsConfig>(
  settings: AppSettings,
  key: K,
  value: HapticsConfig[K],
): AppSettings {
  return { ...settings, haptics: { ...settings.haptics, [key]: value } }
}

/** Reset everything back to `DEFAULTS` (returns a fresh, non-frozen copy). */
export function resetSettingsEntry(): AppSettings {
  return {
    grid: { ...DEFAULTS.grid },
    stream: { ...DEFAULTS.stream },
    highlight: { ...DEFAULTS.highlight },
    clusters: { ...DEFAULTS.clusters },
    events: { ...DEFAULTS.events },
    review: { ...DEFAULTS.review },
    haptics: { ...DEFAULTS.haptics },
    cameraList: { ...DEFAULTS.cameraList },
    deviceInfo: DEFAULTS.deviceInfo,
  }
}

// ── Parsing / validation at the storage boundary ──────────────────────────────

export function isStreamQuality(v: unknown): v is StreamQuality {
  return typeof v === 'string' && (STREAM_QUALITIES as readonly string[]).includes(v)
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function isReelThumbSize(v: unknown): v is ReelThumbSize {
  return typeof v === 'string' && (REEL_THUMB_SIZES as readonly string[]).includes(v)
}

export function isGridDensity(v: unknown): v is GridDensity {
  return typeof v === 'string' && (GRID_DENSITIES as readonly string[]).includes(v)
}

/** Map legacy `showLabels` + `labelStyle` to {@link TileLabelMode}. */
export function migrateTileLabelMode(
  modeField: unknown,
  showLabels: unknown,
  labelStyle: unknown,
  fallback: TileLabelMode,
): TileLabelMode {
  if (isTileLabelMode(modeField)) return modeField
  if (typeof showLabels === 'boolean') {
    if (!showLabels) return 'off'
    if (labelStyle === 'text') return 'label'
    return 'icon'
  }
  return fallback
}

function migrateReelThumbSizePreset(stored: ReelThumbSize, rev: number): ReelThumbSize {
  if (rev >= REEL_THUMB_SIZE_REV) return stored
  if (stored === 'small') return 'medium'
  if (stored === 'medium') return 'large'
  return 'large'
}

/**
 * The device-information overlay position. Documents written by 1.0.596-1.0.598
 * called it `hostBattery` (the phone-battery pill, same position vocabulary), so
 * the legacy key is read when the new one is absent — nobody loses the corner
 * (or the `off`) they picked. The new key wins when both exist.
 */
export function parseDeviceInfoPosition(data: Readonly<Record<string, unknown>>): OverlayPosition {
  if (isOverlayPosition(data['deviceInfo'])) return data['deviceInfo']
  if (isOverlayPosition(data['hostBattery'])) return data['hostBattery']
  return DEFAULTS.deviceInfo
}

/** Parse persisted JSON into a fully-populated `AppSettings`. Never throws:
 *  unknown/corrupt storage degrades field-by-field to `DEFAULTS`, so a partial
 *  or future-version document still yields a usable, validated value. */
export function parseSettings(raw: string | null): AppSettings {
  if (!raw) return resetSettingsEntry()
  let data: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return resetSettingsEntry()
    data = parsed as Record<string, unknown>
  } catch {
    return resetSettingsEntry()
  }

  const grid = (data.grid ?? {}) as Record<string, unknown>
  const stream = (data.stream ?? {}) as Record<string, unknown>
  const highlight = (data.highlight ?? {}) as Record<string, unknown>
  const clusters = (data.clusters ?? {}) as Record<string, unknown>
  const events = (data.events ?? {}) as Record<string, unknown>
  const haptics = (data.haptics ?? {}) as Record<string, unknown>
  const cameraList = (data.cameraList ?? {}) as Record<string, unknown>
  const review = (data.review ?? {}) as Record<string, unknown>
  const color = (v: unknown, fallback: string): string =>
    typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : fallback
  // Documents persisted before the bare-reel default stored `true` for both
  // toggles without the operator ever touching them. Stamp the rev so a later
  // opt-in is kept.
  const migrateReelChrome = num(events.reelChromeRev, 0) < DEFAULTS.events.reelChromeRev

  return {
    grid: {
      motionHoldSec: clampMotionHoldSec(num(grid.motionHoldSec, DEFAULTS.grid.motionHoldSec)),
    },
    stream: {
      // Reads a mode, a legacy boolean, or nothing at all — see
      // `parseAudioOnOpen` for why `true`/`false` keep their answer rather
      // than being folded onto the new default.
      audioOnOpen: parseAudioOnOpen(stream.audioOnOpen),
      pinchExpandsHeight: bool(stream.pinchExpandsHeight, DEFAULTS.stream.pinchExpandsHeight),
      navBarOnStream: bool(stream.navBarOnStream, DEFAULTS.stream.navBarOnStream),
      reopenLastCamera: bool(stream.reopenLastCamera, DEFAULTS.stream.reopenLastCamera),
      // A persisted document from before this setting existed, or one carrying
      // a value no longer offered, reads as the DEFAULT rather than as junk —
      // the same discipline every field above follows.
      toolbarDensity: isToolbarDensity(stream.toolbarDensity)
        ? stream.toolbarDensity
        : DEFAULTS.stream.toolbarDensity,
      landscapeTimeline: isTimelineDock(stream.landscapeTimeline)
        ? stream.landscapeTimeline
        : DEFAULTS.stream.landscapeTimeline,
      // Absent in every document written before the switch existed → the
      // DEFAULT (ON) applies, so an existing install gets the loop without
      // having to go and find a control it has never seen.
      clipLoop: bool(stream.clipLoop, DEFAULTS.stream.clipLoop),
    },
    highlight: {
      motionColor: color(highlight.motionColor, DEFAULTS.highlight.motionColor),
      audioColor: color(highlight.audioColor, DEFAULTS.highlight.audioColor),
      detectionColor: color(highlight.detectionColor, DEFAULTS.highlight.detectionColor),
      thickness: clampThickness(num(highlight.thickness, DEFAULTS.highlight.thickness)),
    },
    clusters: {
      gapPercent: num(clusters.gapPercent, DEFAULTS.clusters.gapPercent),
      cardWidthFraction: clampCardWidthFraction(
        num(clusters.cardWidthFraction, DEFAULTS.clusters.cardWidthFraction),
      ),
      showClass: bool(clusters.showClass, DEFAULTS.clusters.showClass),
    },
    events: (() => {
      const rawReelThumb = events.reelThumbSize
      let storedReelSize: ReelThumbSize = DEFAULTS.events.reelThumbSize
      const hadValidReelSize = isReelThumbSize(rawReelThumb)
      if (hadValidReelSize) storedReelSize = rawReelThumb
      const thumbRev = num(events.reelThumbSizeRev, 0)
      const reelThumbSize =
        hadValidReelSize && thumbRev < REEL_THUMB_SIZE_REV
          ? migrateReelThumbSizePreset(storedReelSize, thumbRev)
          : storedReelSize
      let reelLabelMode = migrateTileLabelMode(
        events.reelLabelMode,
        events.reelShowLabels,
        events.reelLabelStyle,
        DEFAULTS.events.reelLabelMode,
      )
      if (migrateReelChrome) reelLabelMode = 'off'
      const tileLabelMode = migrateTileLabelMode(
        events.tileLabelMode,
        events.tileShowLabels,
        events.tileLabelStyle,
        DEFAULTS.events.tileLabelMode,
      )
      return {
        reelThumbSize,
        reelThumbSizeRev: REEL_THUMB_SIZE_REV,
        gridDensity: isGridDensity(events.gridDensity)
          ? events.gridDensity
          : DEFAULTS.events.gridDensity,
        reelLabelMode,
        reelChromeRev: DEFAULTS.events.reelChromeRev,
        tileLabelMode,
        tileDetailCamera: bool(events.tileDetailCamera, DEFAULTS.events.tileDetailCamera),
        tileDetailZone: bool(events.tileDetailZone, DEFAULTS.events.tileDetailZone),
      }
    })(),
    review: {
      facesShowDate: bool(review.facesShowDate, DEFAULTS.review.facesShowDate),
      facesShowCamera: bool(review.facesShowCamera, DEFAULTS.review.facesShowCamera),
      platesShowDate: bool(review.platesShowDate, DEFAULTS.review.platesShowDate),
      platesShowCamera: bool(review.platesShowCamera, DEFAULTS.review.platesShowCamera),
    },
    haptics: {
      // NOT read from the stored blob: the event pulses have no UI since
      // 2026-09-13 and must not come back on for an operator who had switched
      // them on before. Hydrating the old `true` would re-enable a feature
      // nothing can switch off again.
      enabled: false,
      motion: bool(haptics.motion, DEFAULTS.haptics.motion),
      detection: bool(haptics.detection, DEFAULTS.haptics.detection),
      person: bool(haptics.person, DEFAULTS.haptics.person),
      // Absent in settings persisted before press feedback shipped → the
      // default (ON) applies, so an existing install gets button feedback
      // without having to go and find the switch.
      uiFeedback: bool(haptics.uiFeedback, DEFAULTS.haptics.uiFeedback),
    },
    cameraList: {
      motionBorder: bool(cameraList.motionBorder, DEFAULTS.cameraList.motionBorder),
      motionBadge: isOverlayPosition(cameraList.motionBadge)
        ? cameraList.motionBadge
        : DEFAULTS.cameraList.motionBadge,
      occupancy: isOverlayPosition(cameraList.occupancy)
        ? cameraList.occupancy
        : DEFAULTS.cameraList.occupancy,
    },
    deviceInfo: parseDeviceInfoPosition(data),
  }
}

/**
 * One document from its two halves: the device fields of `device` and the
 * account fields of `account` (each a stored document, parsed or not). A field
 * found on the wrong side is ignored, so a half can never override the other.
 */
export function parseSettingsHalves(device: unknown, account: unknown): AppSettings {
  return parseSettings(JSON.stringify(joinSettingsLevels(device, account)))
}

function parseStored(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ── zustand store (glue) ─────────────────────────────────────────────────────

interface SettingsState {
  readonly settings: AppSettings
  /** True once BOTH halves have loaded — the account half needs a bound hub. */
  readonly hydrated: boolean
  /** The hub the account half in memory belongs to; `null` before it loads. */
  readonly accountServerId: string | null
  hydrate: () => Promise<void>
  setGridDefault: <K extends keyof GridDefaults>(key: K, value: GridDefaults[K]) => void
  setStreamDefault: <K extends keyof StreamDefaults>(key: K, value: StreamDefaults[K]) => void
  setHighlightAppearance: <K extends keyof HighlightAppearance>(key: K, value: HighlightAppearance[K]) => void
  setCluster: <K extends keyof ClusterPreferences>(key: K, value: ClusterPreferences[K]) => void
  setEvents: <K extends keyof EventsPreferences>(key: K, value: EventsPreferences[K]) => void
  setReview: <K extends keyof ReviewPagePreferences>(key: K, value: ReviewPagePreferences[K]) => void
  setHaptics: <K extends keyof HapticsConfig>(key: K, value: HapticsConfig[K]) => void
  setCameraList: <K extends keyof CameraListOverlaySettings>(
    key: K,
    value: CameraListOverlaySettings[K],
  ) => void
  setDeviceInfo: (value: OverlayPosition) => void
  resetSettings: () => void
  /** Adopt an account half (from the account sync, or copied from another
   *  hub). Validated field by field; the device half is untouched. */
  applyAccount: (account: unknown) => void
}

/**
 * Persist both halves. Best-effort: a storage failure is logged but never
 * blocks the in-memory update the user already sees.
 *
 * The DEVICE half waits for a bound hub: binding happens only after the
 * one-time move of the account fields out of this same key
 * (`two-levels-migration.ts`), and a device-only write landing before that
 * move would delete the account fields it has not moved yet.
 */
function persist(settings: AppSettings): void {
  const onError = (e: unknown): void => {
    log.error('settings', 'settings-store persist failed', { error: e instanceof Error ? e.message : String(e) })
  }
  const device = JSON.stringify(pickSettingsLevel(settings, 'device'))
  void whenServerScoped()
    .then(() => AsyncStorage.setItem(SETTINGS_STORAGE_KEY, device))
    .catch(onError)
  const serverId = useSettingsStore.getState().accountServerId
  if (serverId === null) return
  const account = JSON.stringify(pickSettingsLevel(settings, 'account'))
  void AsyncStorage.setItem(scopedStorageKey(SETTINGS_ACCOUNT_STORAGE_KEY, serverId), account).catch(onError)
}

async function readAccountHalf(serverId: string): Promise<unknown> {
  return parseStored(await AsyncStorage.getItem(scopedStorageKey(SETTINGS_ACCOUNT_STORAGE_KEY, serverId)))
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: resetSettingsEntry(),
  hydrated: false,
  accountServerId: null,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      // `advanced.debugMode` is moved out to device-settings BEFORE this
      // document is read and written back (`device-local-migration.ts`).
      await migrateDeviceLocalOnce()
      const device = parseStored(await AsyncStorage.getItem(SETTINGS_STORAGE_KEY))
      // The device half is usable before any hub is bound (sign-in screens).
      set({ settings: parseSettingsHalves(device, null) })
      const serverId = await whenServerScoped()
      if (get().hydrated) return
      // The device half in MEMORY, not re-read: a change made while the hub
      // was being bound must survive the account half landing.
      const settings = parseSettingsHalves(get().settings, await readAccountHalf(serverId))
      set({ settings, accountServerId: serverId, hydrated: true })
      // Write back so a one-shot migration (reel chrome rev) sticks. Idempotent
      // when the document already matches parseSettings.
      persist(settings)
    } catch (e) {
      log.error('settings', 'settings-store hydrate failed', { error: e instanceof Error ? e.message : String(e) })
      set({ hydrated: true })
    }
  },

  setGridDefault: (key, value) => {
    const settings = setGridDefaultEntry(get().settings, key, value)
    set({ settings })
    persist(settings)
  },

  setStreamDefault: (key, value) => {
    const settings = setStreamDefaultEntry(get().settings, key, value)
    set({ settings })
    persist(settings)
  },

  setHighlightAppearance: (key, value) => {
    const settings = setHighlightAppearanceEntry(get().settings, key, value)
    set({ settings })
    persist(settings)
  },

  setCluster: (key, value) => {
    const settings = setClusterEntry(get().settings, key, value)
    set({ settings })
    persist(settings)
  },

  setEvents: (key, value) => {
    const settings = setEventsEntry(get().settings, key, value)
    set({ settings })
    persist(settings)
  },

  setReview: (key, value) => {
    const settings = setReviewEntry(get().settings, key, value)
    set({ settings })
    persist(settings)
  },

  setHaptics: (key, value) => {
    const settings = setHapticsEntry(get().settings, key, value)
    set({ settings })
    persist(settings)
  },

  setCameraList: (key, value) => {
    const settings = setCameraListEntry(get().settings, key, value)
    set({ settings })
    persist(settings)
  },

  setDeviceInfo: (value) => {
    const settings = setDeviceInfoEntry(get().settings, value)
    set({ settings })
    persist(settings)
  },

  resetSettings: () => {
    const settings = resetSettingsEntry()
    set({ settings })
    persist(settings)
  },

  applyAccount: (account) => {
    const settings = parseSettingsHalves(get().settings, account)
    set({ settings })
    persist(settings)
  },
}))

// A hub switch swaps the account half in ONE set carrying the new hub, so the
// account sync can tell a switch from an edit.
onServerScopeChange((serverId) => {
  void readAccountHalf(serverId)
    .catch(() => null)
    .then((account) =>
      useSettingsStore.setState((s) => ({
        settings: parseSettingsHalves(s.settings, account),
        accountServerId: serverId,
        hydrated: true,
      })),
    )
})
