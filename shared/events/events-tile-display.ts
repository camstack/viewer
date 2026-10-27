/**
 * events-tile-display — what an events TILE says, as ONE model for every
 * surface: the viewer app's Events page (`EventsPreferences`) and the events
 * embed (`events-config`, `events-url-config`, the share link).
 *
 * The names are the viewer's own component settings, verbatim:
 *
 *  - `tileLabelMode`   — the chips over the picture: `off` (none), `icon` (the
 *                        class glyph only), `label` (glyph + the finest short
 *                        name known).
 *  - `tileDetailCamera`— the camera name under the picture.
 *  - `tileDetailZone`  — the zone the track visited, under the picture.
 *
 * The clock is not a setting here: both surfaces draw it as a chip on the
 * picture's top-right corner (the legacy embed `fields.time` still switches it
 * off for a host that wants a bare contact sheet).
 *
 * Pure — no React, no window.
 */
import { z } from 'zod'

export const TILE_LABEL_MODES = ['off', 'icon', 'label'] as const
export const tileLabelModeSchema = z.enum(TILE_LABEL_MODES)
export type TileLabelMode = z.infer<typeof tileLabelModeSchema>

export function isTileLabelMode(v: unknown): v is TileLabelMode {
  return typeof v === 'string' && (TILE_LABEL_MODES as readonly string[]).includes(v)
}

export interface TileDisplay {
  readonly tileLabelMode: TileLabelMode
  readonly tileDetailCamera: boolean
  readonly tileDetailZone: boolean
}

/** The viewer's defaults: glyph chips, nothing under the picture. */
export const DEFAULT_TILE_DISPLAY: TileDisplay = Object.freeze({
  tileLabelMode: 'icon',
  tileDetailCamera: false,
  tileDetailZone: false,
})

/** The three settings as optional keys — what a link, a host config or a patch carries. */
export const tileDisplayOverridesSchema = z.object({
  tileLabelMode: tileLabelModeSchema.optional(),
  tileDetailCamera: z.boolean().optional(),
  tileDetailZone: z.boolean().optional(),
})
export type TileDisplayOverrides = z.infer<typeof tileDisplayOverridesSchema>

/** The pre-tile-settings switches an embed host may still send (`fields=`). */
export interface LegacyTileFields {
  readonly label: boolean
  readonly camera: boolean
  readonly badges: boolean
}

/**
 * The display in force. An explicit tile setting wins; when a host has not sent
 * one, the legacy `fields` flag it did send keeps meaning what it always meant
 * (`label` -> text chips, `camera` -> camera line, `badges` -> zone chip), so
 * an existing link renders as before.
 */
export function resolveTileDisplay(
  legacy: LegacyTileFields,
  overrides: TileDisplayOverrides,
): TileDisplay {
  return {
    tileLabelMode: overrides.tileLabelMode ?? (legacy.label ? 'label' : 'off'),
    tileDetailCamera: overrides.tileDetailCamera ?? legacy.camera,
    tileDetailZone: overrides.tileDetailZone ?? legacy.badges,
  }
}
