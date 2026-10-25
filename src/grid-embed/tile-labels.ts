/**
 * tile-labels — the app's words for the wall the EMBED draws.
 *
 * ## Why the strings travel instead of living in the page
 *
 * On iOS and web the wall is a WebView, and that page has no i18n. It could
 * have been given one; it deliberately was not. A second set of strings inside
 * `embed/` would be a set nobody diffs against `locales/{en,it}.json`, and drift
 * between two sets is the ordinary way one label stays in English after
 * everything around it moved. This app has already resolved the operator's
 * language and already owns every other string in the product, so the labels
 * ride in the config the page already receives at the handshake
 * (`window.__CAMSTACK_GRID__`) and the keys live in `locales/` like all the rest.
 *
 * ## The page keeps its English, and that is not a leftover
 *
 * Same discipline as `GRID_SPANS_COMMAND`: the two artifacts version-skew
 * independently — on web the iframe is served by the hub while the app ships on
 * its own chain, and an external integrator writes their own config and sends
 * no labels at all. Every one of those must draw the wall that shipped, in
 * English, complete. `embed/src/embed/tile-labels.ts` holds that fallback, per
 * label, and this file must never send a key or a blank in place of a word.
 *
 * ## The list here is the page's list
 *
 * A key added on one side and not the other is exactly the drift this design
 * exists to prevent, so the two lists are checked against each other by value
 * (`__tests__/tile-labels.spec.ts`) rather than kept in step by hand.
 */
import type { TFunction } from 'i18next'

/** The i18n key behind each of the page's labels. The KEYS of this record are
 *  the page's `TileLabelKey`s; nothing here may invent one of its own. */
export const TILE_LABEL_I18N = {
  play: 'v2.gridTile.play',
  pause: 'v2.gridTile.pause',
  listen: 'v2.gridTile.listen',
  mute: 'v2.gridTile.mute',
  talk: 'v2.gridTile.talk',
  stopTalk: 'v2.gridTile.stopTalk',
  ptz: 'v2.gridTile.ptz',
  linkedDevices: 'v2.gridTile.linkedDevices',
  viewOptions: 'v2.gridTile.viewOptions',
  moreActions: 'v2.gridTile.moreActions',
  open: 'v2.gridTile.open',
  removeFromView: 'v2.gridTile.removeFromView',
  resizeWidth: 'v2.gridTile.resizeWidth',
  resizeHeight: 'v2.gridTile.resizeHeight',
  noActiveCameras: 'v2.gridTile.noActiveCameras',
  camera: 'v2.gridTile.camera',
} as const

export type TileLabelKey = keyof typeof TILE_LABEL_I18N

/** The labels as they cross to the page: every member a resolved string. */
export type TileLabelsEmbedConfig = Readonly<Record<string, string>>

/**
 * Translate every label the page draws.
 *
 * A key that resolves to nothing is OMITTED rather than sent: i18next echoes a
 * missing key back as the key itself, and `v2.gridTile.open` on a button is
 * worse than `Open` — the page's per-label fallback is there precisely so this
 * function can decline. The same for a blank translation.
 */
export function buildTileLabels(t: TFunction): TileLabelsEmbedConfig {
  const out: Record<string, string> = {}
  for (const [key, i18nKey] of Object.entries(TILE_LABEL_I18N)) {
    const value = t(i18nKey)
    if (typeof value !== 'string') continue
    if (value.trim() === '' || value === i18nKey) continue
    out[key] = value
  }
  return out
}
