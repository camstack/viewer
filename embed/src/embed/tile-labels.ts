/**
 * tile-labels — the words on the wall, and where they come from.
 *
 * ## The strings are injected, not built here
 *
 * This page has no i18n and is not getting one. The app around it already
 * resolved the operator's language and already owns `locales/{en,it}.json`; a
 * second set of strings in this artifact would be a set nobody diffs against
 * the first, and drift between two sets is the ordinary way one label stays in
 * English after everything else moved. So the host sends them in the config it
 * already injects at the handshake (`window.__CAMSTACK_GRID__`), the app side
 * builds them from its own keys (`src/grid-embed/tile-labels.ts`), and the keys
 * live in `locales/` with every other string in the product.
 *
 * ## Which makes the English below the contract, not a leftover
 *
 * Same discipline as {@link GRID_SPANS_COMMAND}: the host may be older than the
 * page, and on web the iframe is served by the hub while the app ships on its
 * own chain, so the two version-skew independently. An external integrator
 * embedding this page writes their own config and will send no labels at all.
 * Every one of those cases must draw the wall that shipped — English, complete,
 * never a raw key and never an empty control. That is why the fallback is
 * per-label rather than all-or-nothing: a host that learns a new control before
 * the page does, or a locale missing one string, costs exactly that one word.
 *
 * These labels are `aria-label`s. On an iPad running VoiceOver in Italian they
 * are read aloud, which is precisely the surface where "Remove from view" in
 * the middle of an Italian app is noticed.
 */
import { z } from 'zod'

/** Every word this page draws. One key per control, named after the control. */
export interface TileLabels {
  /** Centre button while paused. */
  readonly play: string
  /** Centre button while playing. */
  readonly pause: string
  /** Audio button while this tile is silent. */
  readonly listen: string
  /** Audio button while this tile is the one being heard. */
  readonly mute: string
  /** Intercom button while the mic is off. */
  readonly talk: string
  /** Intercom button while this tile owns the mic. */
  readonly stopTalk: string
  /** The in-tile PTZ button (the host draws the actual controls). */
  readonly ptz: string
  /** The camera's linked-device panel, hosted by the app. */
  readonly linkedDevices: string
  /** The per-camera view-options menu, hosted by the app. */
  readonly viewOptions: string
  /** The compact overflow on a cell too small for the two above. */
  readonly moreActions: string
  /** Promote this camera to the picture. */
  readonly open: string
  /** Take this camera off the wall, leaving the others. */
  readonly removeFromView: string
  /** The horizontal span grip. */
  readonly resizeWidth: string
  /** The vertical span grip. */
  readonly resizeHeight: string
  /** Shown instead of the wall when `activeOnly` filtered every camera out. */
  readonly noActiveCameras: string
  /** Prefix of a tile's name when the host could not resolve the device's own
   *  ("Camera 5"). A word, not a template: the page appends the id, so no
   *  interpolation engine has to cross the bridge. */
  readonly camera: string
}

/**
 * The wall exactly as it reads today, and the value every unlabelled host gets.
 *
 * Changing one of these strings changes what an OLD host shows, so it is a
 * decision about compatibility rather than a wording tweak — pinned by value in
 * `__tests__/tile-labels.spec.ts` for that reason.
 */
export const DEFAULT_TILE_LABELS: TileLabels = {
  play: 'Play',
  pause: 'Pause',
  listen: 'Listen',
  mute: 'Mute',
  talk: 'Talk',
  stopTalk: 'Stop talk',
  ptz: 'PTZ',
  linkedDevices: 'Linked devices',
  viewOptions: 'View options',
  moreActions: 'More actions',
  open: 'Open',
  removeFromView: 'Remove from view',
  resizeWidth: 'Resize width',
  resizeHeight: 'Resize height',
  noActiveCameras: 'No active cameras',
  camera: 'Camera',
}

export type TileLabelKey = keyof TileLabels

/** Derived from the defaults so a label cannot be added without a fallback:
 *  the two lists are one list. */
export const TILE_LABEL_KEYS = Object.keys(DEFAULT_TILE_LABELS) as readonly TileLabelKey[]

/**
 * The labels as they travel. Every member optional and unknown members ignored:
 * a host that knows one more control than this build must not cost the wall its
 * whole config, and a host that knows one fewer must not be rejected either.
 */
export const tileLabelsSchema = z.record(z.string(), z.string()).optional()

/** What the host may send, before it is merged over the defaults. */
export type TileLabelsConfig = Readonly<Record<string, string>>

/**
 * Merge host words over the English, per label.
 *
 * A blank string is refused rather than honoured: an untranslated key that
 * resolves to `''` would leave a control with no accessible name at all, which
 * is strictly worse than leaving it in English. Anything that is not a string
 * is refused for the same reason — this value crossed a trust boundary.
 */
export function resolveTileLabels(input: unknown): TileLabels {
  if (input === null || typeof input !== 'object') return DEFAULT_TILE_LABELS
  const given = input as Record<string, unknown>
  const out: Record<string, string> = { ...DEFAULT_TILE_LABELS }
  for (const key of TILE_LABEL_KEYS) {
    const value = given[key]
    if (typeof value !== 'string') continue
    if (value.trim() === '') continue
    out[key] = value
  }
  return out as unknown as TileLabels
}
