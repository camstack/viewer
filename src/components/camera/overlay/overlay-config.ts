/**
 * overlay-config — what the operator has chosen to draw ON the video, for EVERY
 * stream.
 *
 * ## One document, not one per camera (2026-11-21)
 *
 * The overlay configuration is global: one document, an ACCOUNT setting (a
 * viewing preference of the person — it follows them to their other devices,
 * unlike the overlay SIZE, which is a share of THIS screen and stays at the
 * device level), applied to every live stream — the single view and every
 * grid tile. The per-camera copies this module used to describe are gone, with
 * no migration: a camera that carried its own document reads the defaults.
 *
 * Every placeable overlay — including the camera name and the two control
 * groups — has a position, and the ones that draw over the picture have a
 * `fade` flag (hide with the auto-hiding controls). Overlays that share an
 * anchor are stacked, never overlapped: see `overlay-stack.ts`.
 *
 * ## Why this exists
 *
 * Everything over the picture was decided in a different place and lived for a
 * different length of time: bounding boxes and stream stats were `useState` in
 * `CameraDetailScreen` (gone on every navigation), the audio meter's corner was
 * a per-camera pref, the occupancy chips and the motion badge were unconditional
 * — no operator could turn them off — and the highlight border read the GLOBAL
 * appearance settings. Five overlays, four owners, and no single answer to "what
 * is on this camera's picture".
 *
 * This is that answer. One per-camera document, persisted with the rest of the
 * camera prefs, read by the panel that edits it and by the layer that draws it.
 *
 * ## Readouts
 *
 * The fixed overlays above are a closed set. `readouts` is the open one: a
 * numeric value pinned to a corner with a label and a unit — the current dBFS,
 * or ANY live field of the camera or of a device linked to it (a thermometer, a
 * lock's battery, a sensor's lux). They come from the device-manager's live-info
 * aggregate, which is the same source the admin UI renders, so the label,
 * the unit and the precision are the ones the operator already knows rather
 * than a second vocabulary invented here.
 *
 * ## Every function below is pure
 *
 * The store is glue; this module is the logic, so it can be tested without a
 * renderer — which this repo does not have (see `docs/roadmap.md`).
 */
import {
  normaliseAnchor,
  normalisePosition,
  type OverlayAnchor,
  type OverlayPosition,
} from './overlay-position.js'
import { clampSizeStep, parseSizeStep } from './overlay-size.js'

/**
 * Where a readout's number comes from — a live field of a device. (The audio
 * level is not a readout: it is the audio meter's number, drawn above its bars.)
 */
export type OverlayReadoutSource =
  | {
      /** A live field of the camera the overlay is DRAWN ON. The document is
       *  global, so "this camera" cannot be a device id: it is whichever stream
       *  the chip lands on. */
      readonly kind: 'cameraField'
      readonly sectionId: string
      readonly fieldKey: string
    }
  | {
      readonly kind: 'deviceField'
      /** The device that owns the field — a device linked to the camera. */
      readonly deviceId: number
      /** Section id within that device's live-info aggregate. */
      readonly sectionId: string
      /** Field key within the section. */
      readonly fieldKey: string
    }

export interface OverlayReadout {
  /** Stable id — the key the list renders by and the patch addresses. */
  readonly id: string
  readonly source: OverlayReadoutSource
  /** What to write next to the value. Seeded from the field's own label. */
  readonly label: string
  /** Appended to the value verbatim (`°C`, `%`, `dB`). Absent = no unit. */
  readonly unit?: string
  /** Decimal places. Absent = show the value as the server formatted it. */
  readonly precision?: number
  /** Where the chip sits — always somewhere: removing the chip is how a
   *  readout goes away, so its position space has no `off`. */
  readonly corner: OverlayAnchor
  /** Hide with the auto-hiding controls. Absent = false. */
  readonly fade?: boolean
  /** Write the sensor's name next to the value. Absent = true; `false` draws
   *  the value alone (planning#751). */
  readonly showLabel?: boolean
  /** The camera a `deviceField` readout was pinned on: it shows only on that
   *  camera's stream. Absent = every stream (audio level, `cameraField`). */
  readonly scope?: number
}

/**
 * ONE layer the box overlay can draw. Four INDEPENDENT booleans, not an ordered
 * scale — and independent by construction, not by convention:
 *
 * - `motion` — the raw changed-pixel regions (`motion.onMotionChanged`
 *   `regions[]`, drawn by `MotionRegionsOverlay`). A different data plane
 *   entirely: this is what an operator tunes motion sensitivity against.
 * - `objects` — the SURVIVORS (`FrameResult.detections`): what came through
 *   NMS, the confidence filter, the full-frame guard and the zone rules. Drawn
 *   by `MotionBoxesOverlay`.
 * - `discarded` — the complement on the SAME frame: the near-miss and
 *   out-of-zone boxes of enabled classes (`FrameResult.discarded` narrowed by
 *   `filterRelevantDiscards`, dashed ghosts + a `model N · kept M · hidden`
 *   pill from `DiscardedBoxesOverlay`). Not literally everything the model
 *   emitted — `class-filter` and `full-frame-guard` drops are counted in the
 *   pill but never drawn.
 * - `stationary` — the PARKED objects (`zoneAnalytics.getCurrentSnapshot`
 *   `stationaryObjects[]`, drawn by `StationaryBoxesOverlay`). Disjoint from
 *   the two above by construction: the hub SUPPRESSES a parked object's
 *   detection (`SUPPRESS_IOU`, server `stationary-registry.ts`), so a parked
 *   car can never arrive through `objects` or `discarded`.
 *
 * ## Why this is a SET and not the scale it replaces
 *
 * It was `off` / `kept` / `all` beside a separate `motionBoxes` boolean. That
 * scale forced `discarded ⊃ objects` — a rung the model's near-misses could
 * only be seen at by also drawing the survivors — and it had no rung at all for
 * the parked objects, which therefore RODE the `objects` switch. Since that
 * switch defaults OFF, a fresh install could not draw a parked car and no
 * operator could ask for "parked only". Four checkboxes say what three rungs
 * could not.
 */
export type OverlayLayer = 'motion' | 'objects' | 'discarded' | 'stationary'

/** The four layers in DISPLAY order — the chip order the panels render, and the
 *  canonical order every stored set is normalised into. One source of truth. */
export const OVERLAY_LAYERS: readonly OverlayLayer[] = Object.freeze([
  'motion',
  'objects',
  'discarded',
  'stationary',
]) as readonly OverlayLayer[]

/** The i18n key naming each layer. Here rather than in a panel because BOTH
 *  panels (single view and grid bar) draw the same chips, and a second
 *  vocabulary in the second panel is how two menus start disagreeing. */
export const LAYER_LABEL_KEY = {
  motion: 'v2.overlay.layerMotion',
  objects: 'v2.overlay.layerObjects',
  discarded: 'v2.overlay.layerDiscarded',
  stationary: 'v2.overlay.layerStationary',
} as const satisfies Readonly<Record<OverlayLayer, string>>

/** Every overlay with its own `fade` flag — the ones that can hide with the
 *  auto-hiding controls. The control groups are not in the list: they ARE the
 *  auto-hiding controls, so they always fade. */
export type FadeableOverlay =
  | 'cameraName'
  | 'doorbell'
  | 'motionBadge'
  | 'audioMeter'
  | 'stats'
  | 'occupancy'
  | 'viewers'

/** Every overlay with its own size step: the fadeable ones plus the
 *  device-info pill (whose POSITION is a device setting, its step is here). */
export type SizedOverlay = FadeableOverlay | 'deviceInfo'

export const SIZED_OVERLAYS: readonly SizedOverlay[] = Object.freeze([
  'cameraName',
  'doorbell',
  'motionBadge',
  'audioMeter',
  'stats',
  'occupancy',
  'viewers',
  'deviceInfo',
]) as readonly SizedOverlay[]

export const SIZE_STEP_DEFAULTS: Readonly<Record<SizedOverlay, number>> = Object.freeze({
  cameraName: 0,
  doorbell: 0,
  motionBadge: 0,
  audioMeter: 0,
  stats: 0,
  occupancy: 0,
  viewers: 0,
  deviceInfo: 0,
})

export const FADEABLE_OVERLAYS: readonly FadeableOverlay[] = Object.freeze([
  'cameraName',
  'doorbell',
  'motionBadge',
  'audioMeter',
  'stats',
  'occupancy',
  'viewers',
]) as readonly FadeableOverlay[]

/** The identity of one thing drawn in a corner stack: a named overlay, the
 *  device-info pill, or one pinned readout (`readout:<id>`). */
export type OverlayItemId =
  | 'cameraName'
  | 'controlsLeft'
  | 'controlsRight'
  | 'doorbell'
  | 'motionBadge'
  | 'audioMeter'
  | 'stats'
  | 'occupancy'
  | 'viewers'
  | 'deviceInfo'
  | `readout:${string}`

/** The global overlay document — what every live stream draws over its picture. */
export interface OverlayConfig {
  /**
   * What the box overlay draws — a CHECKABLE SET of {@link OverlayLayer}, in
   * `OVERLAY_LAYERS` order. Empty = nothing on the picture.
   */
  readonly layers: readonly OverlayLayer[]
  /** The transient "motion" pill: an anchor, or off. */
  readonly motionBadge: OverlayPosition
  /** The camera's configured zones (outline + name) drawn over the picture.
   *  Off by default. */
  readonly zones: boolean
  /** Master-off migration, step 1: a document stored when the border had a
   *  master switch that was OFF. The triggers it silenced are written off
   *  once (`highlight-border.ts`), then this flips to `false` and
   *  {@link OverlayConfig.highlightDefaultOff} takes over. The border itself
   *  has no stored flag any more: it is on when any trigger is on. */
  readonly legacyMasterOff: boolean
  /** Master-off migration, step 2 (permanent): a camera with no stored
   *  triggers starts with every trigger off instead of the factory motion
   *  default, so a config whose border was off stays off everywhere. */
  readonly highlightDefaultOff: boolean
  /** Per overlay: size steps around the main overlay size, −3…+3, 0 = Auto
   *  (the main size). */
  readonly sizeStep: Readonly<Record<SizedOverlay, number>>
  /** Audio meter placement. `OverlayPosition` carries its own `off` member,
   *  so this is one field and not a boolean plus an anchor. */
  readonly audioMeter: OverlayPosition
  /** Occupancy chips: an anchor, or off. */
  readonly occupancy: OverlayPosition
  /** WebRTC/playback health read-out: an anchor, or off. */
  readonly stats: OverlayPosition
  /** How many people watch this camera live right now: an anchor, or off.
   *  Hidden while the count is 0 or unanswered — an unanswered query must never
   *  read as "nobody watching". */
  readonly viewers: OverlayPosition
  /** The live doorbell badge ("last ring N ago", pulses while ringing). OPT-IN:
   *  off until the operator asks for it, and offered only for a camera with the
   *  doorbell feature. A switch and not a position — it sits at
   *  {@link DOORBELL_ANCHOR}, in the stack of that corner. */
  readonly doorbell: boolean
  /** The corner the doorbell badge sits in (never `off`: the switch above is
   *  the on/off). Default {@link DOORBELL_ANCHOR}. */
  readonly doorbellAnchor: OverlayAnchor
  /** The camera's name over the picture: an anchor, or off. ON at the top-left
   *  by default — it used to be a fixed, always-on tag. */
  readonly cameraName: OverlayPosition
  /** The left control group (mute, talk, history, PTZ). An anchor and never
   *  `off`: hiding the controls outright would leave nothing to press. */
  readonly controlsLeft: OverlayAnchor
  /** The right control group (play/pause, PiP, fullscreen). Same as above. */
  readonly controlsRight: OverlayAnchor
  /** Per overlay: hide together with the auto-hiding controls. */
  readonly fade: Readonly<Record<FadeableOverlay, boolean>>
  /**
   * The operator's stacking order, first = nearest the corner. An overlay
   * joins the END when it is placed, so "user order" is simply the order they
   * were placed in. Ids absent from the list follow in the default order
   * (`overlay-stack.ts`). Never required to be complete or clean: stale and
   * unknown ids are dropped on read.
   */
  readonly order: readonly OverlayItemId[]
  readonly readouts: readonly OverlayReadout[]
}

/** The corner the doorbell badge sits in until the operator moves it. */
export const DOORBELL_ANCHOR: OverlayAnchor = 'top-left'

/** `fade` defaults: only the camera name hides with the controls — it did
 *  before this was a flag, and every other overlay stays visible as it was. */
export const FADE_DEFAULTS: Readonly<Record<FadeableOverlay, boolean>> = Object.freeze({
  cameraName: true,
  doorbell: false,
  motionBadge: false,
  audioMeter: false,
  stats: false,
  occupancy: false,
  viewers: false,
})

/**
 * Defaults. Occupancy is off until the operator places it. The audio meter is
 * on at top-center. Boxes and stats stay off, and so does the motion pill (the
 * regions / highlight border are the motion treatment). The camera name is on
 * at the top-left and fades; the control groups sit where they always did.
 */
export const OVERLAY_DEFAULTS: OverlayConfig = Object.freeze({
  layers: Object.freeze([]) as readonly OverlayLayer[],
  motionBadge: 'off',
  zones: false,
  legacyMasterOff: false,
  highlightDefaultOff: false,
  sizeStep: SIZE_STEP_DEFAULTS,
  audioMeter: 'top-center',
  occupancy: 'off',
  stats: 'off',
  viewers: 'off',
  doorbell: false,
  doorbellAnchor: DOORBELL_ANCHOR,
  cameraName: 'top-left',
  controlsLeft: 'bottom-left',
  controlsRight: 'bottom-right',
  fade: FADE_DEFAULTS,
  order: Object.freeze([]) as readonly OverlayItemId[],
  readouts: Object.freeze([]) as readonly OverlayReadout[],
}) as OverlayConfig

// ── Pure reducers ────────────────────────────────────────────────────────────

/** Apply a partial patch, returning a NEW config. */
export function patchOverlay(
  config: OverlayConfig,
  patch: Partial<OverlayConfig>,
): OverlayConfig {
  return { ...config, ...patch }
}

/** Is this layer drawn? A membership test, never a truthiness test — every
 *  layer name is a truthy string. */
export function hasLayer(config: OverlayConfig, layer: OverlayLayer): boolean {
  return config.layers.includes(layer)
}

/** Flip ONE layer, leaving the other three exactly as they were. Returns a NEW
 *  config, with the set back in canonical order. */
export function toggleLayer(
  config: OverlayConfig,
  layer: OverlayLayer,
): OverlayConfig {
  const next = hasLayer(config, layer)
    ? config.layers.filter((l) => l !== layer)
    : [...config.layers, layer]
  return { ...config, layers: canonicalLayers(next) }
}

/**
 * Add a readout, or REPLACE the existing one with the same source.
 *
 * Replacing rather than appending is the whole point: the picker lists fields,
 * and tapping the same field twice must not stack two identical chips in the
 * same corner where they would draw on top of each other and only one could be
 * removed by tapping.
 */
export function addReadout(
  config: OverlayConfig,
  readout: OverlayReadout,
): OverlayConfig {
  const without = config.readouts.filter((r) => !sameSource(r.source, readout.source))
  return { ...config, readouts: [...without, readout] }
}

export function removeReadout(config: OverlayConfig, id: string): OverlayConfig {
  return { ...config, readouts: config.readouts.filter((r) => r.id !== id) }
}

export function patchReadout(
  config: OverlayConfig,
  id: string,
  patch: Partial<Omit<OverlayReadout, 'id' | 'source'>>,
): OverlayConfig {
  return {
    ...config,
    readouts: config.readouts.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }
}

export function sameSource(a: OverlayReadoutSource, b: OverlayReadoutSource): boolean {
  if (a.kind === 'cameraField') {
    return b.kind === 'cameraField' && a.sectionId === b.sectionId && a.fieldKey === b.fieldKey
  }
  return (
    b.kind === 'deviceField' &&
    a.deviceId === b.deviceId &&
    a.sectionId === b.sectionId &&
    a.fieldKey === b.fieldKey
  )
}

/** A deterministic id for a source — so the same field always maps to the same
 *  readout, and a config round-tripped through storage keeps its identity. */
export function readoutId(source: OverlayReadoutSource): string {
  if (source.kind === 'cameraField') return `cam:${source.sectionId}:${source.fieldKey}`
  return `dev:${source.deviceId}:${source.sectionId}:${source.fieldKey}`
}

/** The readouts assigned to one corner, in insertion order. */
/** The readouts this camera's stream shows: the unscoped ones plus those
 *  pinned on this very camera. */
export function readoutsForCamera(
  readouts: readonly OverlayReadout[],
  cameraId: number,
): readonly OverlayReadout[] {
  return readouts.filter((r) => r.scope === undefined || r.scope === cameraId)
}

export function readoutsAt(
  config: OverlayConfig,
  corner: OverlayAnchor,
): readonly OverlayReadout[] {
  return config.readouts.filter((r) => r.corner === corner)
}

// ── Storage normalisation ────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}


/** The retired fields a stored GRID document may still carry. Named rather than
 *  read off a `Record<string, unknown>` so the migration below type-checks. */
export interface LegacyLayerFields {
  /** @deprecated → the `objects` / `discarded` / `stationary` layers. */
  readonly boxes?: unknown
  /** @deprecated → the `motion` layer. */
  readonly motionBoxes?: unknown
  /** @deprecated → the `discarded` layer. */
  readonly discardedBoxes?: unknown
}

/**
 * The RUNGS of the retired scale, expressed as layer sets.
 *
 * Read this as "what the screen was drawing at that rung", not as a rename:
 * `kept` carried the parked objects because `StationaryBoxesOverlay`'s drawing
 * lived inside `MotionBoxesOverlay` and was mounted by the very same gate. An
 * operator on `kept` today IS looking at parked boxes, and a migration that
 * dropped them would take a working overlay away without a word.
 */
const LEGACY_BOXES_LAYERS = {
  off: [],
  kept: ['objects', 'stationary'],
  all: ['objects', 'discarded', 'stationary'],
} as const satisfies Readonly<Record<'off' | 'kept' | 'all', readonly OverlayLayer[]>>

/** Whatever a stored `boxes` field held, as one of the three rungs. */
function legacyRung(rawBoxes: unknown, rawDiscarded: unknown): 'off' | 'kept' | 'all' {
  // `discardedBoxes: true` wins over any `boxes` value: the ghosts were a layer
  // the operator deliberately turned on, and 'off' would erase them.
  if (rawDiscarded === true) return 'all'
  if (rawBoxes === 'kept' || rawBoxes === 'all' || rawBoxes === 'off') return rawBoxes
  if (rawBoxes === true) return 'kept'
  return 'off'
}

/**
 * Migrate the retired GRID document's `boxes` / `discardedBoxes` / `motionBoxes` fields onto the
 * layer set. Table-driven, because every one of these rows is a picture some
 * operator is looking at right now:
 *
 *   stored                          | layers
 *   ------------------------------- | ------------------------------------
 *   boxes: 'off'                    | —
 *   boxes: 'kept'                   | objects, stationary
 *   boxes: 'all'                    | objects, discarded, stationary
 *   boxes: true   (legacy boolean)  | objects, stationary
 *   boxes: false  (legacy boolean)  | —
 *   discardedBoxes: true            | objects, discarded, stationary
 *   motionBoxes: true               | + motion
 *   junk / absent                   | —
 */
export function migrateLegacyLayers(raw: LegacyLayerFields): readonly OverlayLayer[] {
  const fromBoxes = LEGACY_BOXES_LAYERS[legacyRung(raw.boxes, raw.discardedBoxes)]
  const withMotion = raw.motionBoxes === true ? ['motion' as const, ...fromBoxes] : fromBoxes
  return canonicalLayers(withMotion)
}


/** Keep only known layers, drop duplicates, and return them in
 *  `OVERLAY_LAYERS` order — so a set compares by value however it was clicked
 *  or however storage happened to serialise it. */
export function canonicalLayers(raw: unknown): readonly OverlayLayer[] {
  if (!Array.isArray(raw)) return []
  return OVERLAY_LAYERS.filter((layer) => raw.includes(layer))
}

function normaliseSource(raw: unknown): OverlayReadoutSource | null {
  if (!isRecord(raw)) return null
  if (
    raw.kind === 'cameraField' &&
    typeof raw.sectionId === 'string' &&
    typeof raw.fieldKey === 'string'
  ) {
    return { kind: 'cameraField', sectionId: raw.sectionId, fieldKey: raw.fieldKey }
  }
  if (
    raw.kind === 'deviceField' &&
    typeof raw.deviceId === 'number' &&
    typeof raw.sectionId === 'string' &&
    typeof raw.fieldKey === 'string'
  ) {
    return {
      kind: 'deviceField',
      deviceId: raw.deviceId,
      sectionId: raw.sectionId,
      fieldKey: raw.fieldKey,
    }
  }
  return null
}

function normaliseReadout(raw: unknown): OverlayReadout | null {
  if (!isRecord(raw)) return null
  const source = normaliseSource(raw.source)
  if (source === null) return null
  if (typeof raw.label !== 'string') return null
  // `normaliseAnchor` also migrates the pre-merge camelCase spelling
  // (`bottomLeft`) — a stored chip must keep its corner, not reset.
  const corner = normaliseAnchor(raw.corner) ?? 'top-right'
  const readout: {
    id: string
    source: OverlayReadoutSource
    label: string
    unit?: string
    precision?: number
    corner: OverlayAnchor
    fade?: boolean
    showLabel?: boolean
    scope?: number
  } = {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : readoutId(source),
    source,
    label: raw.label,
    corner,
  }
  if (typeof raw.unit === 'string' && raw.unit.length > 0) readout.unit = raw.unit
  if (raw.fade === true) readout.fade = true
  if (raw.showLabel === false) readout.showLabel = false
  if (source.kind === 'deviceField' && typeof raw.scope === 'number' && Number.isFinite(raw.scope)) {
    readout.scope = raw.scope
  }
  if (typeof raw.precision === 'number' && Number.isFinite(raw.precision)) {
    readout.precision = Math.max(0, Math.min(6, Math.trunc(raw.precision)))
  }
  return readout
}

const OVERLAY_ITEM_NAMES: ReadonlySet<string> = new Set([
  'cameraName',
  'controlsLeft',
  'controlsRight',
  'doorbell',
  'motionBadge',
  'audioMeter',
  'stats',
  'occupancy',
  'viewers',
  'deviceInfo',
])

function isOverlayItemId(v: unknown): v is OverlayItemId {
  return typeof v === 'string' && (OVERLAY_ITEM_NAMES.has(v) || v.startsWith('readout:'))
}

function parseSizeSteps(raw: unknown): Readonly<Record<SizedOverlay, number>> {
  const stored = isRecord(raw) ? raw : {}
  const out: Record<SizedOverlay, number> = { ...SIZE_STEP_DEFAULTS }
  for (const key of SIZED_OVERLAYS) out[key] = parseSizeStep(stored[key])
  return out
}

function parseFade(raw: unknown): Readonly<Record<FadeableOverlay, boolean>> {
  const stored = isRecord(raw) ? raw : {}
  const out: Record<FadeableOverlay, boolean> = { ...FADE_DEFAULTS }
  for (const key of FADEABLE_OVERLAYS) {
    if (typeof stored[key] === 'boolean') out[key] = stored[key]
  }
  return out
}

/**
 * Narrow whatever storage (or the account) returned into the overlay document,
 * field by field. Never throws and never rejects a document wholesale: an
 * unknown value falls back to ITS default, a readout that cannot be read is
 * dropped on its own, and the rest survives.
 */
export function parseOverlayConfig(raw: unknown): OverlayConfig {
  if (!isRecord(raw)) return OVERLAY_DEFAULTS
  const position = (v: unknown, fallback: OverlayPosition): OverlayPosition =>
    normalisePosition(v) ?? fallback
  const anchor = (v: unknown, fallback: OverlayAnchor): OverlayAnchor =>
    normaliseAnchor(v) ?? fallback
  const readouts = Array.isArray(raw.readouts)
    ? raw.readouts.map(normaliseReadout).filter((r): r is OverlayReadout => r !== null)
    : OVERLAY_DEFAULTS.readouts
  // The audio readout was retired into the audio meter (planning#745): a
  // stored one is dropped here, and a user who had it on gets the meter on.
  const retiredAudio = Array.isArray(raw.readouts)
    ? raw.readouts.find((r) => isRecord(r) && isRecord(r.source) && r.source.kind === 'audioDbfs')
    : undefined
  const meterStored = position(raw.audioMeter, OVERLAY_DEFAULTS.audioMeter)
  const audioMeter: OverlayPosition =
    meterStored === 'off' && isRecord(retiredAudio)
      ? (normaliseAnchor(retiredAudio.corner) ?? 'top-right')
      : meterStored
  const fade = parseFade(raw.fade)
  const migratedFade =
    isRecord(retiredAudio) && retiredAudio.fade === true ? { ...fade, audioMeter: true } : fade
  const seen = new Set<string>()
  const order = (Array.isArray(raw.order) ? raw.order : []).filter(
    (id): id is OverlayItemId => isOverlayItemId(id) && !seen.has(id) && !!seen.add(id),
  )
  return {
    layers: canonicalLayers(raw.layers),
    motionBadge: position(raw.motionBadge, OVERLAY_DEFAULTS.motionBadge),
    zones: raw.zones === true,
    // A document from before the master switch left: `highlightBorder: false`
    // means "every trigger off", materialised once by `highlight-border.ts`.
    legacyMasterOff: raw.legacyMasterOff === true || raw.highlightBorder === false,
    highlightDefaultOff: raw.highlightDefaultOff === true,
    sizeStep: parseSizeSteps(raw.sizeStep),
    audioMeter,
    occupancy: position(raw.occupancy, OVERLAY_DEFAULTS.occupancy),
    stats: position(raw.stats, OVERLAY_DEFAULTS.stats),
    viewers: position(raw.viewers, OVERLAY_DEFAULTS.viewers),
    // Strictly `true`: a document stored before the field existed reads as off.
    doorbell: raw.doorbell === true,
    doorbellAnchor: anchor(raw.doorbellAnchor, OVERLAY_DEFAULTS.doorbellAnchor),
    cameraName: position(raw.cameraName, OVERLAY_DEFAULTS.cameraName),
    controlsLeft: anchor(raw.controlsLeft, OVERLAY_DEFAULTS.controlsLeft),
    controlsRight: anchor(raw.controlsRight, OVERLAY_DEFAULTS.controlsRight),
    fade: migratedFade,
    order,
    readouts,
  }
}

/** Does the screen draw the doorbell badge? Only for a doorbell camera whose
 *  operator switched it on, while the live overlays are showing. */
export function doorbellBadgeEnabled(input: {
  readonly hasDoorbell: boolean
  /** `OverlayConfig.doorbell` */
  readonly switchedOn: boolean
  readonly overlaysVisible: boolean
}): boolean {
  return input.hasDoorbell && input.switchedOn && input.overlaysVisible
}

/**
 * Move an overlay to a position. A placed overlay joins the END of the order
 * (the operator's own order is the order they placed things in), and moving to
 * `off` leaves the order alone. Returns a NEW config.
 */
export function placeOverlay(
  config: OverlayConfig,
  id: OverlayItemId,
  next: OverlayPosition,
): OverlayConfig {
  const order = next === 'off' ? config.order : [...config.order.filter((o) => o !== id), id]
  switch (id) {
    case 'cameraName':
      return { ...config, cameraName: next, order }
    case 'audioMeter':
      return { ...config, audioMeter: next, order }
    case 'occupancy':
      return { ...config, occupancy: next, order }
    case 'stats':
      return { ...config, stats: next, order }
    case 'viewers':
      return { ...config, viewers: next, order }
    case 'motionBadge':
      return { ...config, motionBadge: next, order }
    case 'doorbell':
      return next === 'off' ? config : { ...config, doorbellAnchor: next, order }
    case 'controlsLeft':
      return next === 'off' ? config : { ...config, controlsLeft: next, order }
    case 'controlsRight':
      return next === 'off' ? config : { ...config, controlsRight: next, order }
    default:
      return config
  }
}

/** Where an overlay lands when the operator switches it on: its natural
 *  corner, never `off`. */
export function defaultAnchorFor(id: OverlayItemId): OverlayAnchor {
  switch (id) {
    case 'cameraName':
      return 'top-left'
    case 'audioMeter':
      return 'top-center'
    case 'controlsLeft':
      return 'bottom-left'
    case 'controlsRight':
      return 'bottom-right'
    case 'doorbell':
      return DOORBELL_ANCHOR
    default:
      return 'top-right'
  }
}

/** Set one overlay's size step (clamped to −3…+3). Returns a NEW config. */
export function setSizeStep(config: OverlayConfig, id: SizedOverlay, step: number): OverlayConfig {
  return { ...config, sizeStep: { ...config.sizeStep, [id]: clampSizeStep(step) } }
}

/** The size step of a stack item: 0 (Auto) for anything without one. */
export function sizeStepOf(config: OverlayConfig, id: OverlayItemId): number {
  return isSizedOverlay(id) ? config.sizeStep[id] : 0
}

export function isSizedOverlay(id: string): id is SizedOverlay {
  return SIZED_OVERLAYS.some((k) => k === id)
}

/** Set one overlay's `fade` flag. Returns a NEW config. */
export function setFade(
  config: OverlayConfig,
  id: FadeableOverlay,
  on: boolean,
): OverlayConfig {
  return { ...config, fade: { ...config.fade, [id]: on } }
}

/**
 * Is this overlay drawn right now? An overlay with `fade` on follows the
 * auto-hiding controls (`controlsVisible`); one without stays. The two control
 * groups are the controls themselves and always follow them — the disc group
 * owns that hide, so they answer `true` here.
 */
export function isOverlayShown(
  config: OverlayConfig,
  id: OverlayItemId,
  controlsVisible: boolean,
): boolean {
  if (id === 'controlsLeft' || id === 'controlsRight' || id === 'deviceInfo') return true
  if (id.startsWith('readout:')) {
    const readout = config.readouts.find((r) => `readout:${r.id}` === id)
    return readout?.fade === true ? controlsVisible : true
  }
  return isFadeable(id) && config.fade[id] ? controlsVisible : true
}

function isFadeable(id: OverlayItemId): id is FadeableOverlay {
  return (FADEABLE_OVERLAYS as readonly string[]).includes(id)
}

/** True when the config is indistinguishable from the defaults — the store
 *  drops it rather than persisting a document that says nothing. */
export function isDefaultOverlay(config: OverlayConfig): boolean {
  return (
    config.layers.length === 0 &&
    config.motionBadge === OVERLAY_DEFAULTS.motionBadge &&
    config.zones === OVERLAY_DEFAULTS.zones &&
    !config.legacyMasterOff &&
    !config.highlightDefaultOff &&
    SIZED_OVERLAYS.every((k) => config.sizeStep[k] === 0) &&
    config.audioMeter === OVERLAY_DEFAULTS.audioMeter &&
    config.occupancy === OVERLAY_DEFAULTS.occupancy &&
    config.stats === OVERLAY_DEFAULTS.stats &&
    config.viewers === OVERLAY_DEFAULTS.viewers &&
    config.doorbell === OVERLAY_DEFAULTS.doorbell &&
    config.doorbellAnchor === OVERLAY_DEFAULTS.doorbellAnchor &&
    config.cameraName === OVERLAY_DEFAULTS.cameraName &&
    config.controlsLeft === OVERLAY_DEFAULTS.controlsLeft &&
    config.controlsRight === OVERLAY_DEFAULTS.controlsRight &&
    FADEABLE_OVERLAYS.every((k) => config.fade[k] === FADE_DEFAULTS[k]) &&
    config.order.length === 0 &&
    config.readouts.length === 0
  )
}
