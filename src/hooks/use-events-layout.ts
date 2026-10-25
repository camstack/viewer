/**
 * use-events-layout — how the Events page arranges itself across widths. Built
 * ON TOP of the existing responsive primitives (useGridColumns +
 * useWideDetailLayout) rather than a new breakpoint system, so it stays in sync
 * with every other screen.
 *
 * Three modes (see `events-layout-rules` for the pure, testable decision):
 *   • `'phone'` — a single column of rows; detail opens in the modal.
 *   • `'grid'`  — a masonry of tiles; detail opens in the modal.
 *   • `'split'` — a masonry of tiles that gives up one column to a persistent
 *      detail pane on the right; selecting a tile fills the pane, not a modal.
 */
import { useGridColumns, useWideDetailLayout } from './use-responsive.js'
import { resolveEventsLayout, type EventsLayout } from './events-layout-rules.js'

export {
  resolveEventsLayout,
  EVENTS_MAX_CONTENT_WIDTH,
  type EventsLayout,
  type EventsLayoutMode,
  type EventsLayoutInput,
} from './events-layout-rules.js'

/** Hook form: reads the shared responsive primitives and resolves the layout. */
export function useEventsLayout(): EventsLayout {
  const columns = useGridColumns()
  const wide = useWideDetailLayout()
  return resolveEventsLayout({ columns, wide })
}
