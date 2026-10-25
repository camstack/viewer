/**
 * Builder for the grid-embed page config injected as `window.__CAMSTACK_GRID__`.
 *
 * The shape MUST match the server's `embed-grid-config` zod schema (hosted by the
 * stream-broker addon): `{ serverUrl, token, devices, layout, quality, showName,
 * showBadges, muted, paused }`. Pure — unit-tested in isolation.
 */
import type { GridQuality, GridLayout, ResolvedGridOptions, GridHighlightSettings } from '../store/grid-store.js'
import type { HighlightAppearance } from '../store/settings-store.js'
import { DEFAULT_OVERLAY_SIZE, type OverlaySize } from '../components/camera/overlay/overlay-size.js'
import { hasLayer, type CameraOverlayConfig } from '../components/camera/overlay/overlay-config.js'
import type { OverlayAnchor, OverlayPosition } from '../components/camera/overlay/overlay-position.js'
import type { GridCellSpan } from './embed-messages.js'
import type { TileLabelsEmbedConfig } from './tile-labels.js'

/** Highlight config as injected into the embed: the per-grid settings plus the
 *  bar's master `enabled` toggle and the global appearance (color/thickness).
 *  Mirrors the server `gridHighlightSchema`. */
export interface GridHighlightEmbedConfig extends GridHighlightSettings {
  readonly enabled: boolean
  readonly appearance?: HighlightAppearance
  /** Motion-highlight linger, seconds (global `grid.motionHoldSec`). Forwarded
   *  so the server embed can keep the motion border lit this long after motion
   *  stops. NOTE: the server's `use-tile-highlight` does not yet honor a motion
   *  hold (motion clears immediately there) — consuming this is a server
   *  follow-up; the native grid tile already lingers via `useMotionHighlight`. */
  readonly motionHoldSec?: number
}

/**
 * ONE camera's indicators as they travel to the embed. Mirrors the page's
 * `tileOverlaySchema` (`embed/src/embed/embed-grid-config.ts`).
 *
 * This is the protocol's first PER-DEVICE channel — everything before it
 * (highlight, boxes, names, quality) was one value for the whole wall. It
 * exists because the per-cell view-options menu offers these per camera, and a
 * menu may only offer what something DRAWS: on iOS/web the thing that draws a
 * tile is the embed, so the embed has to be told.
 */
export interface TileOverlayEmbedConfig {
  readonly motionBoxes?: boolean
  readonly motionBadge?: OverlayPosition
  readonly audioMeter?: OverlayPosition
  readonly occupancy?: OverlayPosition
  readonly stats?: boolean
  /** Where the read-out sits. Travels BESIDE `stats` rather than replacing it,
   *  so a page built before it still draws the read-out (at its old corner) and
   *  a page built after it reads an absent field as that same corner. */
  readonly statsAt?: OverlayAnchor
  /** How many people watch this camera live. */
  readonly viewers?: OverlayPosition
  /** The device's overlay size. Absent = `medium`, so a wall that never touched
   *  the setting sends exactly the bytes it always did; the page reads an
   *  absent field as medium. */
  readonly size?: OverlaySize
}

/**
 * The tile-drawn rows of ONE camera's overlay document, or `null` when the
 * camera placed nothing.
 *
 * Null rather than a record of falsy members on purpose: the map is re-pushed
 * whenever any camera's prefs change, and an entry per camera saying
 * "everything off" is bytes across the bridge on every push for no effect.
 *
 * The rows here are exactly the `cell`-owned picture rows of
 * `grid/view-options-scope` — the detector layers and the highlight border are
 * the BAR's, and they already travel in `showBoxes` / `highlight`.
 *
 * `motionBoxes` keeps its wire name deliberately: the page's schema
 * (`embed/src/embed/embed-grid-config.ts`) is a separate, separately-built
 * artifact, and renaming a field the viewer and the page must agree on to match
 * an internal refactor is how a wall goes blank after an OTA.
 */
export function tileOverlayFor(
  overlay: CameraOverlayConfig,
  size: OverlaySize = DEFAULT_OVERLAY_SIZE,
): TileOverlayEmbedConfig | null {
  const config: TileOverlayEmbedConfig = {
    ...(hasLayer(overlay, 'motion') ? { motionBoxes: true } : {}),
    ...(overlay.motionBadge !== 'off' ? { motionBadge: overlay.motionBadge } : {}),
    ...(overlay.audioMeter !== 'off' ? { audioMeter: overlay.audioMeter } : {}),
    ...(overlay.occupancy !== 'off' ? { occupancy: overlay.occupancy } : {}),
    ...(overlay.stats !== 'off' ? { stats: true, statsAt: overlay.stats } : {}),
    ...(overlay.viewers !== 'off' ? { viewers: overlay.viewers } : {}),
  }
  if (Object.keys(config).length === 0) return null
  // The size rides only on a camera that draws something — it describes how
  // those indicators are drawn, and says nothing about a camera that has none.
  return size === DEFAULT_OVERLAY_SIZE ? config : { ...config, size }
}

/** One camera's resolved overlay, as the caller reads it out of the prefs. */
export interface CameraOverlayEntry {
  readonly deviceId: number
  readonly overlay: CameraOverlayConfig
}

/** The per-device map the embed receives — only the cameras that placed
 *  something. Keys are device ids as STRINGS (a JSON object's keys always are;
 *  the page reads `overlays[String(deviceId)]`). */
export function buildTileOverlayMap(
  entries: readonly CameraOverlayEntry[],
  size: OverlaySize = DEFAULT_OVERLAY_SIZE,
): Readonly<Record<string, TileOverlayEmbedConfig>> {
  const map: Record<string, TileOverlayEmbedConfig> = {}
  for (const entry of entries) {
    const config = tileOverlayFor(entry.overlay, size)
    if (config !== null) map[String(entry.deviceId)] = config
  }
  return map
}

/** The validated config the embed page reads from `window.__CAMSTACK_GRID__`. */
export interface GridEmbedConfig {
  readonly serverUrl: string
  readonly token: string
  readonly devices: readonly number[]
  readonly layout: GridLayout
  readonly quality: GridQuality
  readonly showName: boolean
  readonly showBadges: boolean
  readonly muted: boolean
  readonly paused: boolean
  readonly highlight?: GridHighlightEmbedConfig
  readonly activeOnly?: boolean
  /** Live detection bounding-box overlay on every tile (session toggle). */
  readonly showBoxes?: boolean
  readonly audioOnIds?: readonly number[]
  readonly pausedIds?: readonly number[]
  readonly ptzIds?: readonly number[]
  /** Per-device indicators, keyed by device id (string). Absent ⇒ no camera
   *  placed one. */
  readonly overlays?: Readonly<Record<string, TileOverlayEmbedConfig>>
  /** This wall is the operator's VIEW, not a saved grid: its cells carry a
   *  remove control and a resize handle, and this host answers `tileRemove` /
   *  `tileResize`. Absent ⇒ false — every saved grid. */
  readonly editable?: boolean
  /** Per-device track spans, keyed by device id (string). Absent ⇒ the evenly
   *  distributed wall. */
  readonly spans?: Readonly<Record<string, GridCellSpan>>
  /** The page's words, already translated (`tile-labels.ts`). Absent ⇒ the page
   *  draws the English it ships with — which is what an older host, and any
   *  external iframe writing its own config, must keep getting. */
  readonly labels?: TileLabelsEmbedConfig
}

/**
 * The subset of a grid's resolved options the embed page renders from.
 *
 * Narrower than `ResolvedGridOptions` on purpose: the highlight master
 * switch, the active-only filter and the boxes overlay are per-grid settings
 * too, but they reach the embed through the explicit `highlight` / `activeOnly`
 * / `showBoxes` fields below (whose shapes the server schema owns), so taking
 * the whole options bag here would offer callers two ways to say the same thing.
 */
export interface GridEmbedRenderOptions extends Pick<ResolvedGridOptions, 'showName' | 'layout'> {
  /** The wall's tier — device-local, resolved by the host from
   *  `grid-local-store` (it is not a grid option any more). */
  readonly quality: GridQuality
}

export interface BuildGridEmbedConfigInput {
  readonly serverUrl: string
  readonly token: string
  /** Ordered, already-visible camera ids (hidden ones filtered by the caller). */
  readonly deviceIds: readonly number[]
  readonly options: GridEmbedRenderOptions
  readonly muted: boolean
  readonly paused: boolean
  readonly highlight?: GridHighlightEmbedConfig
  readonly activeOnly?: boolean
  /** Live detection bounding-box overlay on every tile (session toggle). */
  readonly showBoxes?: boolean
  readonly audioOnIds?: readonly number[]
  readonly pausedIds?: readonly number[]
  /** Device ids that support PTZ (host knows from camera features) → tiles show
   *  an in-tile PTZ button; the host renders the native controls on tap. */
  readonly ptzIds?: readonly number[]
  /** Per-device indicators (see {@link buildTileOverlayMap}). */
  readonly overlays?: Readonly<Record<string, TileOverlayEmbedConfig>>
  /** This wall is the operator's view: its cells can be removed and resized. */
  readonly editable?: boolean
  /** Per-device track spans (see {@link GridCellSpan}). */
  readonly spans?: Readonly<Record<string, GridCellSpan>>
  /** The page's words, already translated (see {@link buildTileLabels}). */
  readonly labels?: TileLabelsEmbedConfig
}

/** Map a resolved grid + connection into the embed page's injected config. */
export function buildGridEmbedConfig(input: BuildGridEmbedConfigInput): GridEmbedConfig {
  return {
    serverUrl: input.serverUrl,
    token: input.token,
    devices: [...input.deviceIds],
    layout: input.options.layout,
    quality: input.options.quality,
    showName: input.options.showName,
    // Event badges are a server-side follow-up (Plan 1b); request them so the
    // embed turns them on once available — harmless no-op until then.
    showBadges: true,
    muted: input.muted,
    paused: input.paused,
    // Only include highlight / activeOnly when set so the config stays identical
    // for callers that don't use them.
    ...(input.highlight ? { highlight: input.highlight } : {}),
    ...(input.activeOnly ? { activeOnly: true } : {}),
    ...(input.showBoxes ? { showBoxes: true } : {}),
    ...(input.audioOnIds && input.audioOnIds.length > 0 ? { audioOnIds: [...input.audioOnIds] } : {}),
    ...(input.pausedIds && input.pausedIds.length > 0 ? { pausedIds: [...input.pausedIds] } : {}),
    ...(input.ptzIds && input.ptzIds.length > 0 ? { ptzIds: [...input.ptzIds] } : {}),
    ...(input.overlays && Object.keys(input.overlays).length > 0
      ? { overlays: input.overlays }
      : {}),
    // Omitted rather than sent as `false`/`{}` so a saved grid's config stays
    // byte-identical to the one that shipped: the injected config is what a
    // reload re-runs, and a config that changed shape for every caller would
    // make the compat story impossible to reason about.
    ...(input.editable === true ? { editable: true } : {}),
    ...(input.spans && Object.keys(input.spans).length > 0 ? { spans: input.spans } : {}),
    // Omitted when empty, like every optional field above: a caller that sends
    // no words must produce the config that shipped, byte for byte, so the
    // page's English fallback is reached by absence rather than by an empty map.
    ...(input.labels && Object.keys(input.labels).length > 0 ? { labels: input.labels } : {}),
  }
}
