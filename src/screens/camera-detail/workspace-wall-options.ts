/**
 * workspace-wall-options — what the camera-detail WALL's control bar changes,
 * and how that combines with what the wall showed before the bar existed.
 *
 * ## The bar is the grid page's, the document is not
 *
 * The wall built from the reel is an ad-hoc grid, and it carries the SAME bar a
 * saved grid carries (`GridControlBar`): pause all, audio, quality, layout, the
 * highlight menu (master switch, triggers, box layers) and active-only. What it
 * does NOT have is a saved grid behind it, so every value the bar sets lands
 * here — in the session workspace (`workspace-store.ts`), never in
 * `grid-store.ts` and never in a camera's preferences:
 *
 * - **device-local**: the workspace store is in memory on this device and is
 *   not part of anything shared or exported;
 * - **session-scoped**: it is not persisted, and it is dropped the moment the
 *   view is (the close button, removing the last member) — the next view starts
 *   from the primary again.
 *
 * It lives in the store rather than in a component because the screen REMOUNTS
 * on every camera switch (`<CameraDetailScreen key={deviceId}>`), and promoting
 * a cell is a camera switch: a `useState` would forget the operator's quality
 * pick on the one gesture the wall offers most.
 *
 * ## Absent means "follow the primary"
 *
 * Before the bar, the wall's tier, highlight border and detection boxes were the
 * PRIMARY camera's documents applied wall-wide, and the timeline's chips still
 * edit those. Every field below is optional and an absent field resolves to
 * exactly that value, so a wall nobody touched the bar on draws what it drew
 * before. A field the bar set wins for the rest of the session.
 *
 * Pure — no React, no store.
 */
import type { OverlayLayer } from '../../components/camera/overlay/overlay-config.js'
import type { GridHighlightEmbedConfig } from '../../grid-embed/embed-config.js'
import {
  withHighlightDefaults,
  type GridHighlightSettings,
  type GridLayout,
} from '../../store/grid-store.js'
import type { StreamQuality } from '../../store/settings-store.js'

/** What the bar has said, field by field. Absent ⇒ the primary's value. */
export interface WorkspaceWallOptions {
  readonly quality?: StreamQuality
  /** `'auto'` keeps the wall's own split (the primary enlarged); a number pins
   *  that many columns, evenly. */
  readonly layout?: GridLayout
  /** The highlight border's master switch. */
  readonly highlightOn?: boolean
  /** The highlight TRIGGERS the bar's menu edited. Merged over the primary's. */
  readonly highlight?: Partial<GridHighlightSettings>
  /** The box layers the bar's menu checked (the grid page's `BAR_LAYERS`). */
  readonly layers?: readonly OverlayLayer[]
  readonly activeOnly?: boolean
}

export const NO_WALL_OPTIONS: WorkspaceWallOptions = {}

/** What the wall showed before the bar — the primary's documents. */
export interface WorkspaceWallPrimary {
  readonly quality: StreamQuality
  /** The primary's highlight config, NOT yet gated on the live edge. */
  readonly highlight: GridHighlightEmbedConfig
  /** The primary's `objects` layer. */
  readonly showBoxes: boolean
}

/** Everything the wall and its bar draw, resolved. */
export interface ResolvedWorkspaceWall {
  readonly quality: StreamQuality
  readonly layout: GridLayout
  readonly highlightOn: boolean
  /** The triggers as the bar's menu edits them (defaults filled). */
  readonly highlightSettings: GridHighlightSettings
  /** The embed's highlight config, live-edge gate applied. */
  readonly highlight: GridHighlightEmbedConfig
  readonly layers: readonly OverlayLayer[]
  /** The embed's single box switch — the `objects` layer. */
  readonly showBoxes: boolean
  readonly activeOnly: boolean
}

const OBJECT_LAYERS: readonly OverlayLayer[] = ['objects']
const NO_LAYERS: readonly OverlayLayer[] = []

/**
 * The embed draws its OWN highlight; off the live edge it must stop, or it
 * paints live triggers over recorded footage. One function for the picture and
 * the wall, so the gate cannot be applied to one and forgotten on the other.
 */
export function gateLiveHighlight(
  config: GridHighlightEmbedConfig,
  liveOverlaysVisible: boolean,
): GridHighlightEmbedConfig {
  if (liveOverlaysVisible) return config
  return { ...config, enabled: false, motion: false, detection: false, audio: 'off' }
}

/** Pick the trigger fields out of an embed config (it extends them). */
function triggersOf(config: GridHighlightEmbedConfig): GridHighlightSettings {
  return withHighlightDefaults({
    motion: config.motion,
    audio: config.audio,
    audioDb: config.audioDb,
    audioHoldSec: config.audioHoldSec,
    detection: config.detection,
    detectionHoldSec: config.detectionHoldSec,
    detectionClasses: config.detectionClasses,
    clusterLabel: config.clusterLabel,
  })
}

export function resolveWorkspaceWall(
  primary: WorkspaceWallPrimary,
  options: WorkspaceWallOptions,
  liveOverlaysVisible: boolean,
): ResolvedWorkspaceWall {
  const highlightOn = options.highlightOn ?? primary.highlight.enabled
  const highlightSettings = { ...triggersOf(primary.highlight), ...(options.highlight ?? {}) }
  const layers = options.layers ?? (primary.showBoxes ? OBJECT_LAYERS : NO_LAYERS)
  return {
    quality: options.quality ?? primary.quality,
    layout: options.layout ?? 'auto',
    highlightOn,
    highlightSettings,
    highlight: gateLiveHighlight(
      { ...primary.highlight, ...highlightSettings, enabled: highlightOn },
      liveOverlaysVisible,
    ),
    layers,
    showBoxes: layers.includes('objects'),
    activeOnly: options.activeOnly ?? false,
  }
}

/** Toggle one layer in or out — the bar's layer chips. */
export function toggleWallLayer(
  layers: readonly OverlayLayer[],
  layer: OverlayLayer,
): readonly OverlayLayer[] {
  return layers.includes(layer) ? layers.filter((l) => l !== layer) : [...layers, layer]
}

/** The bar's Mute all / Unmute all: any camera listening ⇒ none; else all. */
export function toggleWallAudio(
  audioOnIds: readonly number[],
  wallIds: readonly number[],
): readonly number[] {
  return audioOnIds.length > 0 ? [] : [...wallIds]
}
