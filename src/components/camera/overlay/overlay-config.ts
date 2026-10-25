/**
 * overlay-config — what the operator has chosen to draw ON the video, per camera.
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

/**
 * Where a readout's number comes from.
 *
 * `audioDbfs` is special-cased rather than expressed as a device field because
 * it is not one: the dBFS the meter shows arrives on the live audio-inference
 * event, not through the settings aggregate, and it updates per second rather
 * than per poll.
 */
export type OverlayReadoutSource =
  | { readonly kind: 'audioDbfs' }
  | {
      readonly kind: 'deviceField'
      /** The device that owns the field — the camera itself, or one linked to it. */
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

/** The per-camera overlay document. */
export interface CameraOverlayConfig {
  /**
   * What the box overlay draws — a CHECKABLE SET of {@link OverlayLayer}, in
   * `OVERLAY_LAYERS` order. Empty = nothing on the picture.
   *
   * This replaced a `boxes: 'off'|'kept'|'all'` scale AND a separate
   * `motionBoxes` boolean. `normaliseOverlay` migrates both, preserving what
   * the screen DREW rather than what the field was called — see
   * {@link migrateLegacyLayers}.
   */
  readonly layers: readonly OverlayLayer[]
  /** The transient "motion" pill: an anchor, or off.
   *
   *  Was a boolean pinned to the top-right. It became a position on
   *  2026-08-02 so the operator can place it like every other overlay — and so
   *  the cameras list can show it too, where the top-right is already taken.
   *  `normaliseOverlay` migrates the stored booleans. */
  readonly motionBadge: OverlayPosition
  /** The per-camera highlight border. */
  readonly highlightBorder: boolean
  /** Audio meter placement. `OverlayPosition` carries its own `off` member,
   *  so this is one field and not a boolean plus an anchor. */
  readonly audioMeter: OverlayPosition
  /** Occupancy chips: an anchor, or off. */
  readonly occupancy: OverlayPosition
  /** WebRTC/playback health read-out: an anchor, or off.
   *
   *  Was a boolean (top-left panel on the single view, top-right pill on a
   *  tile) until 2026-10-07; it is placed with the same selector as the motion
   *  badge, the audio meter and the occupancy chips. `normaliseOverlay`
   *  migrates the stored booleans. */
  readonly stats: OverlayPosition
  /** How many people watch this camera live right now: an anchor, or off.
   *  Hidden while the count is 0 or unanswered — an unanswered query must never
   *  read as "nobody watching". */
  readonly viewers: OverlayPosition
  readonly readouts: readonly OverlayReadout[]
}

/**
 * Fresh-camera defaults. Occupancy is off until the operator places it (it
 * used to ship on because the chips were unconditional). The audio meter is
 * on at top-center — the same place, the same component — on the single
 * player and on every grid tile. Boxes and stats stay off. The motion pill
 * stays off: the overlay (regions / highlight border) is the motion treatment.
 */
export const OVERLAY_DEFAULTS: CameraOverlayConfig = Object.freeze({
  layers: Object.freeze([]) as readonly OverlayLayer[],
  motionBadge: 'off',
  highlightBorder: true,
  audioMeter: 'top-center',
  occupancy: 'off',
  stats: 'off',
  viewers: 'off',
  readouts: Object.freeze([]) as readonly OverlayReadout[],
}) as CameraOverlayConfig

/** Where a camera stored with the retired `stats: true` draws its read-out. */
export const LEGACY_STATS_POSITION: OverlayAnchor = 'top-right'

// ── Pure reducers ────────────────────────────────────────────────────────────

/** Apply a partial patch, returning a NEW config. */
export function patchOverlay(
  config: CameraOverlayConfig,
  patch: Partial<CameraOverlayConfig>,
): CameraOverlayConfig {
  return { ...config, ...patch }
}

/** Is this layer drawn? A membership test, never a truthiness test — every
 *  layer name is a truthy string. */
export function hasLayer(config: CameraOverlayConfig, layer: OverlayLayer): boolean {
  return config.layers.includes(layer)
}

/** Flip ONE layer, leaving the other three exactly as they were. Returns a NEW
 *  config, with the set back in canonical order. */
export function toggleLayer(
  config: CameraOverlayConfig,
  layer: OverlayLayer,
): CameraOverlayConfig {
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
  config: CameraOverlayConfig,
  readout: OverlayReadout,
): CameraOverlayConfig {
  const without = config.readouts.filter((r) => !sameSource(r.source, readout.source))
  return { ...config, readouts: [...without, readout] }
}

export function removeReadout(config: CameraOverlayConfig, id: string): CameraOverlayConfig {
  return { ...config, readouts: config.readouts.filter((r) => r.id !== id) }
}

export function patchReadout(
  config: CameraOverlayConfig,
  id: string,
  patch: Partial<Omit<OverlayReadout, 'id' | 'source'>>,
): CameraOverlayConfig {
  return {
    ...config,
    readouts: config.readouts.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }
}

export function sameSource(a: OverlayReadoutSource, b: OverlayReadoutSource): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'audioDbfs' || b.kind === 'audioDbfs') return true
  return a.deviceId === b.deviceId && a.sectionId === b.sectionId && a.fieldKey === b.fieldKey
}

/** A deterministic id for a source — so the same field always maps to the same
 *  readout, and a config round-tripped through storage keeps its identity. */
export function readoutId(source: OverlayReadoutSource): string {
  return source.kind === 'audioDbfs'
    ? 'audio-dbfs'
    : `dev:${source.deviceId}:${source.sectionId}:${source.fieldKey}`
}

/** The readouts assigned to one corner, in insertion order. */
export function readoutsAt(
  config: CameraOverlayConfig,
  corner: OverlayAnchor,
): readonly OverlayReadout[] {
  return config.readouts.filter((r) => r.corner === corner)
}

// ── Storage normalisation ────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** The retired fields a stored document may still carry. Named rather than
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
 * Migrate the retired `boxes` / `discardedBoxes` / `motionBoxes` fields onto the
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
  if (raw.kind === 'audioDbfs') return { kind: 'audioDbfs' }
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
  } = {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : readoutId(source),
    source,
    label: raw.label,
    corner,
  }
  if (typeof raw.unit === 'string' && raw.unit.length > 0) readout.unit = raw.unit
  if (typeof raw.precision === 'number' && Number.isFinite(raw.precision)) {
    readout.precision = Math.max(0, Math.min(6, Math.trunc(raw.precision)))
  }
  return readout
}

/**
 * Narrow whatever storage returned into a config, field by field.
 *
 * Never throws and never rejects a document wholesale: a readout pointing at a
 * device that has since been removed is dropped on its own, and the rest of the
 * overlay survives. An operator who loses one chip to a deleted sensor should
 * not also lose the audio meter's corner.
 */
export function normaliseOverlay(raw: unknown): CameraOverlayConfig | undefined {
  if (!isRecord(raw)) return undefined
  // Both position fields migrate the legacy camelCase corner spelling — the
  // vocabularies were unified on 2026-08-02 and a persisted `bottomLeft` must
  // land on `bottom-left`, never silently reset to the default.
  const audioMeter: OverlayPosition = normalisePosition(raw.audioMeter) ?? OVERLAY_DEFAULTS.audioMeter
  const occupancy: OverlayPosition =
    normalisePosition(raw.occupancy) ?? OVERLAY_DEFAULTS.occupancy
  // `motionBadge` was a BOOLEAN until 2026-08-02. A camera persisted before
  // that holds true/false, and dropping to the default would silently switch
  // the badge back on for someone who had turned it off — so map the old
  // vocabulary explicitly: true → where it always drew, false → off.
  const motionBadge: OverlayPosition =
    raw.motionBadge === true
      ? 'top-right'
      : raw.motionBadge === false
        ? 'off'
        : (normalisePosition(raw.motionBadge) ?? OVERLAY_DEFAULTS.motionBadge)
  const readouts = Array.isArray(raw.readouts)
    ? raw.readouts.map(normaliseReadout).filter((r): r is OverlayReadout => r !== null)
    : OVERLAY_DEFAULTS.readouts
  // A canonical `layers` is authoritative: a document that carries it has
  // already been migrated, and re-reading the retired fields would let a
  // stale `boxes` resurrect a layer the operator has since switched off.
  // `stats` was a BOOLEAN until 2026-10-07: true → the top-right corner (where
  // the tile pill always drew, and the one corner of the single view no other
  // chrome claims), false → off.
  const stats: OverlayPosition =
    raw.stats === true
      ? LEGACY_STATS_POSITION
      : raw.stats === false
        ? 'off'
        : (normalisePosition(raw.stats) ?? OVERLAY_DEFAULTS.stats)
  const viewers: OverlayPosition = normalisePosition(raw.viewers) ?? OVERLAY_DEFAULTS.viewers
  const layers = Array.isArray(raw.layers)
    ? canonicalLayers(raw.layers)
    : migrateLegacyLayers(raw)
  return {
    layers,
    motionBadge,
    highlightBorder: raw.highlightBorder !== false,
    audioMeter,
    occupancy,
    stats,
    viewers,
    readouts,
  }
}

/** True when the config is indistinguishable from the defaults — the store
 *  drops it rather than persisting a document that says nothing. */
export function isDefaultOverlay(config: CameraOverlayConfig): boolean {
  return (
    config.layers.length === 0 &&
    config.motionBadge === OVERLAY_DEFAULTS.motionBadge &&
    config.highlightBorder === OVERLAY_DEFAULTS.highlightBorder &&
    config.audioMeter === OVERLAY_DEFAULTS.audioMeter &&
    config.occupancy === OVERLAY_DEFAULTS.occupancy &&
    config.stats === OVERLAY_DEFAULTS.stats &&
    config.viewers === OVERLAY_DEFAULTS.viewers &&
    config.readouts.length === 0
  )
}
