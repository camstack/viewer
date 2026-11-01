/**
 * How much of the camera list the cameras tab realises at once.
 *
 * ## Why the defaults were the problem
 *
 * `FlatList`'s defaults are `windowSize: 21` and `maxToRenderPerBatch: 10`: it
 * keeps ten screens of rows on EACH side of the viewport, and fills that window
 * in batches ten at a time, a batch every 50 ms. On a cold start the window is
 * empty, so a list of N cameras is built as a run of commits that each mount ten
 * cards — every card carries its own snapshot, badge and kind-label hooks.
 * Measured on the web build with the CPU slowed 4x against a 48-camera hub: 20
 * cards mounted two seconds after launch, 30 by three, and the main thread was
 * busy until 3.7 s, with a first tap answered after 365 ms. The operator sees it
 * as "the app opens, then does not respond for a few seconds".
 *
 * ## What this changes
 *
 * Only how far AHEAD of the fold the list builds, never what a card looks like
 * or where it sits. Two screens of lookahead each way is enough that an ordinary
 * flick lands on a built row; a fast fling past it shows the row a frame late
 * rather than the whole tab paying for rows nobody scrolled to.
 *
 * Snapshot demand does not depend on this: it follows `onViewableItemsChanged`
 * (`data/snapshot-viewport.ts`), not what is mounted.
 */
export const CAMERAS_LIST_WINDOW = Object.freeze({
  /** Rows built in the first commit — enough to fill a phone, not the install. */
  initialNumToRender: 6,
  /** Rows mounted per batch once the list is running. */
  maxToRenderPerBatch: 4,
  /** Viewports kept built: the visible one plus two each side. */
  windowSize: 5,
  /** Gap between batches (ms): input gets a turn between two of them. */
  updateCellsBatchingPeriod: 80,
})
