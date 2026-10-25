/** Pure Events-page layout rules (no react-native import) so they're unit-
 *  testable in vitest's node env — mirrors `sidebar-rules.ts`. The hook wrapper
 *  lives in `use-events-layout.ts`. */

export type EventsLayoutMode = 'phone' | 'grid' | 'split'

export interface EventsLayout {
  readonly mode: EventsLayoutMode
  /** Gallery column count for the CURRENT mode (1 in phone; split reserves one
   *  base column for the detail pane, floored at 2). */
  readonly columns: number
  /** Whether the persistent right-hand detail pane is shown (split only). */
  readonly showDetailPane: boolean
  /** Max content width (pt) for the centered gallery on ultrawide displays. */
  readonly maxContentWidth: number
}

export interface EventsLayoutInput {
  /** Base responsive column count (from useGridColumns). */
  readonly columns: number
  /** Wide-detail eligibility (from useWideDetailLayout). */
  readonly wide: boolean
}

/** Center the gallery on very wide displays instead of stretching cards. */
export const EVENTS_MAX_CONTENT_WIDTH = 1600

/** Fewest masonry columns to keep beside the detail pane in split mode. */
const SPLIT_MIN_COLUMNS = 2

/**
 * Resolve the Events layout from the base grid columns + wide-detail flag.
 *
 *   mode = columns <= 1 ? 'phone' : wide ? 'split' : 'grid'
 *
 * In split mode one base column is handed to the detail pane (min 2 remain).
 */
export function resolveEventsLayout({ columns, wide }: EventsLayoutInput): EventsLayout {
  if (columns <= 1) {
    return { mode: 'phone', columns: 1, showDetailPane: false, maxContentWidth: EVENTS_MAX_CONTENT_WIDTH }
  }
  if (wide) {
    return {
      mode: 'split',
      columns: Math.max(SPLIT_MIN_COLUMNS, columns - 1),
      showDetailPane: true,
      maxContentWidth: EVENTS_MAX_CONTENT_WIDTH,
    }
  }
  return { mode: 'grid', columns, showDetailPane: false, maxContentWidth: EVENTS_MAX_CONTENT_WIDTH }
}
