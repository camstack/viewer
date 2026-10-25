/**
 * grid-export — export grid configs as JSON + the platform-aware text delivery
 * used by the share dialog. (Standalone share LINKS are built by
 * `grid-embed/share-url.ts` and delivered by `GridShareDialog` via
 * `shareOrCopy`.)
 *
 * Delivery is platform-aware (`shareOrCopy`): native uses the OS share sheet
 * (`Share.share`), but on react-native-web that sheet is a no-op, so on web we
 * copy the payload to the clipboard (`navigator.clipboard`) and surface an
 * optional confirmation. All the PURE serialization/parsing lives in
 * `srcV2/grid/grid-export-shape.ts` (no `react-native` import → unit-testable);
 * this module only adds the side-effecting delivery wrappers and re-exports the
 * pure surface for callers.
 */
import { Platform, Share } from 'react-native'
import type { Grid } from '../store/grid-store.js'
import { serializeGrid, serializeGrids } from '../grid/grid-export-shape.js'
import { copyText } from '../lib/copy-text.js'

export {
  type ExportedGrid,
  type GridExportEnvelope,
  gridToExportShape,
  buildGridExport,
  serializeGrid,
  serializeGrids,
  parseGridExport,
} from '../grid/grid-export-shape.js'

/** Deliver a text payload to the user. On web the native share sheet does
 *  nothing, so copy to the clipboard and (optionally) confirm; on native use the
 *  OS share sheet. Best-effort — a failure is logged, never thrown.
 *  Exported for the share dialog (`GridShareDialog`), which delivers the built
 *  share link through the same platform-aware path. */
export async function shareOrCopy(
  text: string,
  opts: { readonly title?: string; readonly copiedMessage?: string } = {},
): Promise<void> {
  if (Platform.OS === 'web') {
    // Delegate the clipboard write to the shared, fail-soft helper so every
    // copy path funnels through one implementation.
    const ok = await copyText(text)
    if (ok && opts.copiedMessage && typeof window !== 'undefined') window.alert(opts.copiedMessage)
    return
  }
  try {
    await Share.share(opts.title ? { message: text, title: opts.title } : { message: text })
  } catch (e: unknown) {
    console.error('[grid-export] share failed', e)
  }
}

/** Export one grid's config as JSON (native sheet / web clipboard). Used by the
 *  builder's "export" action. `copiedMessage` is shown only on web. */
export async function exportGrid(grid: Grid, copiedMessage?: string): Promise<void> {
  await shareOrCopy(serializeGrid(grid), { title: grid.name, copiedMessage })
}

/** Export every grid's config in one JSON payload (native sheet / web clipboard). */
export async function exportAllGrids(grids: readonly Grid[], copiedMessage?: string): Promise<void> {
  if (grids.length === 0) return
  await shareOrCopy(serializeGrids(grids), { copiedMessage })
}
