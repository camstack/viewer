/**
 * Where the active-tab pill sits, as plain numbers.
 *
 * The bar slides ONE pill between the four destinations instead of repainting a
 * background on whichever entry is active, so the pill needs a target: which
 * slot, how far across, how wide. The entries share the row equally, so the
 * target follows from the row's measured width and the active index alone.
 * Pure — the bar animates toward whatever this returns.
 */

export interface TabPillTarget {
  /** Index of the lit entry in the list, or -1 when no entry is lit (Settings). */
  readonly index: number
  /** Offset from the row's left edge, points. */
  readonly x: number
  /** Width of one slot, points. */
  readonly width: number
  /** False until the row is measured and while no entry is lit. */
  readonly visible: boolean
}

export function tabPillTarget(
  activeSegment: string | null,
  items: readonly { readonly segment: string }[],
  rowWidth: number,
): TabPillTarget {
  const index = activeSegment === null ? -1 : items.findIndex((item) => item.segment === activeSegment)
  const measured = Number.isFinite(rowWidth) && rowWidth > 0 && items.length > 0
  const width = measured ? rowWidth / items.length : 0
  return { index, x: index >= 0 ? index * width : 0, width, visible: measured && index >= 0 }
}
