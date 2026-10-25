import { z } from 'zod'
import { tileLabelsSchema } from './tile-labels'
import { requireTokenUnlessTransportAuthenticated } from './transport-auth'

/**
 * Stream-quality presets accepted from the host (grid-wide).
 *
 * The system's profile enum (`CamProfileSchema` in `@camstack/types`:
 * `high|mid|low`) plus `auto`, which is not a profile — it is "you pick", and
 * `qualityToTarget` maps it to `{ kind: 'adaptive' }` instead of to a tier.
 *
 * It used to say `medium`, a word only the viewer's grid path spelled, and both
 * this page and the host carried a translation to `mid` on the way to the
 * broker. Unified on 2026-09-02 (operator: "la scala deve essere unica ed
 * utilizzare la enum di sistema, sempre"). `.catch('auto')` rather than a hard
 * failure: a host or a saved link written before that says `medium`, and the
 * decision was to normalise an unknown value to the DEFAULT on read, never to
 * translate it and never to reject the whole config over it.
 */
export const gridQualitySchema = z.enum(['auto', 'high', 'mid', 'low']).catch('auto')
export type GridQuality = z.infer<typeof gridQualitySchema>

/** Layout: 'auto' (area-maximizing) or a fixed column count (>=1). */
export const gridLayoutSchema = z.union([z.literal('auto'), z.number().int().min(1)])
export type GridLayout = z.infer<typeof gridLayoutSchema>

/** Per-grid highlight config (host-injected). `enabled` is the bar's master
 *  toggle; the rest are the per-grid triggers applied to every tile. Optional
 *  for forward-compat — absent ⇒ highlight off. */
export const gridHighlightSchema = z.object({
  enabled: z.boolean(),
  motion: z.boolean(),
  /** Seconds the motion highlight lingers after motion clears; absent/0 = clear instantly (legacy). */
  motionHoldSec: z.number().optional(),
  audio: z.enum(['off', 'sensor', 'level']),
  audioDb: z.number(),
  audioHoldSec: z.number(),
  detection: z.boolean(),
  detectionHoldSec: z.number(),
  /** Macro classes that trigger the detection highlight; empty/absent = any. */
  detectionClasses: z.array(z.string()).optional(),
  /** Border appearance (global) — color per type + thickness. Absent = defaults. */
  appearance: z
    .object({
      motionColor: z.string(),
      audioColor: z.string(),
      detectionColor: z.string(),
      thickness: z.number(),
    })
    .optional(),
})
export type GridHighlightConfig = z.infer<typeof gridHighlightSchema>

/** A place on the picture, or hidden — mirrors the app's `OverlayPosition`. */
export const overlayPositionSchema = z.enum([
  'off',
  'top-left',
  'top-center',
  'top-right',
  'left-center',
  'right-center',
  'bottom-left',
  'bottom-center',
  'bottom-right',
])

/**
 * ONE camera's indicators, as the app's per-cell view-options menu set them.
 *
 * This is the protocol's first PER-DEVICE channel: everything before it
 * (highlight, boxes, names) was one value for the whole wall. It exists because
 * the cell menu offers these per camera, and a control nothing paints is a dead
 * control — see `tile-overlays`. Every member optional: a camera that placed
 * nothing simply has no entry, and an older host that sends none keeps the
 * wall exactly as it was.
 */
export const tileOverlaySchema = z.object({
  /** Motion REGIONS (changed-pixel rectangles), not detection boxes. */
  motionBoxes: z.boolean().optional(),
  /** The transient "motion" pill. */
  motionBadge: overlayPositionSchema.optional(),
  /** The audio-level meter. */
  audioMeter: overlayPositionSchema.optional(),
  /** The occupancy chips. */
  occupancy: overlayPositionSchema.optional(),
  /** The stream read-out (playback quality — the peer is not exposed here). */
  stats: z.boolean().optional(),
  /** Where the read-out sits. Absent (a host built before it) = top-right,
   *  where the tile always drew it. `off` is said by `stats`, never here. */
  statsAt: overlayPositionSchema.exclude(['off']).optional(),
  /** How many people watch this camera live — an eye and a number. */
  viewers: overlayPositionSchema.optional(),
  /** The device's overlay size (`small | medium | large`). Absent (a host that
   *  never touched the setting, or one built before it) = `medium`. */
  size: z.enum(['small', 'medium', 'large']).optional(),
})
export type TileOverlayConfig = z.infer<typeof tileOverlaySchema>

/**
 * ONE camera's size on the wall, in TRACKS of the wall's own grid. Mirrors
 * `GridCellSpan` on the host (`src/grid-embed/embed-messages.ts`) and
 * `CellSpan` in `grid-layout` — a size, never a position; see either for why an
 * `x` must not cross this bridge.
 */
export const cellSpanSchema = z.object({
  cw: z.number(),
  ch: z.number(),
})
export type CellSpanConfig = z.infer<typeof cellSpanSchema>

export const gridConfigSchema = z.object({
  serverUrl: z.string().min(1),
  /**
   * Bearer share token. OPTIONAL only in the transport-authenticated case: a
   * `serverUrl` that is a same-origin PATH means a relay on this page's own
   * origin injects the credential server-side, and shipping a second copy of it
   * into the browser is pure exposure (see `transport-auth.ts`). An ABSOLUTE
   * `serverUrl` is a direct hub address and still requires it — enforced by the
   * refinement below, so this stays a named case and not a weakened rule.
   */
  token: z.string().min(1).optional(),
  devices: z.array(z.number().int().nonnegative()).min(1),
  layout: gridLayoutSchema,
  quality: gridQualitySchema,
  showName: z.boolean(),
  showBadges: z.boolean(),
  muted: z.boolean(),
  paused: z.boolean(),
  highlight: gridHighlightSchema.optional(),
  /** Show only currently-active cameras (motion/audio/detection per `highlight`). */
  activeOnly: z.boolean().optional(),
  /** Live detection bounding-box overlay on every tile. Host-owned session
   *  toggle (pushed at runtime via setShowBoxes). Absent ⇒ off. */
  showBoxes: z.boolean().optional(),
  /** Device ids whose audio starts ON (combinable — more than one allowed). The
   *  host owns this set at runtime and pushes updates via setAudioOn. */
  audioOnIds: z.array(z.number().int().nonnegative()).optional(),
  /** Device ids that start PAUSED. Host-owned at runtime (pushed via setPaused);
   *  drives the bar's mass play/pause (anyPaused = non-empty). */
  pausedIds: z.array(z.number().int().nonnegative()).optional(),
  /** Per-device last-known snapshot data URLs, keyed by device id (string). Used
   *  ONLY as the cold-start poster before a tile's first frame; the live stream
   *  and its retained frame take over once playing. Pushed at runtime via
   *  setSnapshots. Absent ⇒ tiles cold-start on a plain loader. */
  snapshots: z.record(z.string(), z.string()).optional(),
  /** Device ids that support PTZ — the host knows from each camera's features.
   *  Tiles for these cameras show an in-tile PTZ button (the host renders the
   *  actual PTZ controls natively on tap). Absent ⇒ no PTZ buttons. */
  ptzIds: z.array(z.number().int().nonnegative()).optional(),
  /** PER-DEVICE indicator config, keyed by device id (string). Pushed at
   *  runtime via setOverlays. Absent ⇒ no camera placed an indicator. */
  overlays: z.record(z.string(), tileOverlaySchema).optional(),
  /**
   * This wall is a VIEW the operator is building, not a saved grid: its cells
   * may be taken off and resized, and the host answers `tileRemove` /
   * `tileResize`. Absent ⇒ false, which is every grid that ships today.
   *
   * The page cannot infer this. A remove button on a wall whose host ignores the
   * message is dead chrome, and on a host that DID act it would silently edit a
   * saved grid nobody asked to edit — so the host has to say.
   */
  editable: z.boolean().optional(),
  /**
   * Whether the host can SHOW the tile's secondary panels — the camera's
   * linked devices and its view-options menu, both of which are host
   * surfaces, not embed ones.
   *
   * Absent ⇒ true, which is the app: it has those panels and has always
   * drawn the buttons. A host that cannot show them (the Home Assistant
   * dashboard card, which has nowhere to mount them) says `false`, and the
   * page withholds the callback — the tile already handles a host without
   * panels, and keeps the PTZ button put instead of collapsing it behind a
   * list that would never open. Without this the two discs were drawn on
   * every tile in Home Assistant and did nothing when tapped (operator,
   * 2026-09-07).
   */
  cellPanels: z.boolean().optional(),
  /** Per-device track spans, keyed by device id (string). Pushed at runtime via
   *  setSpans. Absent (or all 1×1) ⇒ the evenly distributed wall. */
  spans: z.record(z.string(), cellSpanSchema).optional(),
  /**
   * The page's words, ALREADY TRANSLATED by the host — it has resolved the
   * operator's language and owns the app's locale files, and a second set of
   * strings in this artifact would be a set nobody diffs against the first.
   *
   * Absent ⇒ the English that ships (`tile-labels.ts`). That is the whole
   * compatibility story: an older host, or an external iframe writing its own
   * config, draws exactly the wall it drew before this field existed.
   */
  labels: tileLabelsSchema,
}).superRefine(requireTokenUnlessTransportAuthenticated)

export type GridConfig = z.infer<typeof gridConfigSchema>

export type GridConfigResult =
  | { readonly ok: true; readonly config: GridConfig }
  | { readonly ok: false; readonly error: string }

/** Validate an untrusted config object. Pure — used by tests and the reader. */
export function parseGridConfig(raw: unknown): GridConfigResult {
  if (raw === undefined || raw === null) {
    return { ok: false, error: 'config is required' }
  }
  const parsed = gridConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    }
  }
  return { ok: true, config: parsed.data }
}

/** Read + validate `window.__CAMSTACK_GRID__` (set by the host before load). */
export function readGridConfig(): GridConfigResult {
  const raw = (window as unknown as { __CAMSTACK_GRID__?: unknown }).__CAMSTACK_GRID__
  if (raw === undefined || raw === null) {
    return { ok: false, error: 'window.__CAMSTACK_GRID__ is not set' }
  }
  return parseGridConfig(raw)
}
