/**
 * WHERE the "Recent" reel goes on the Cameras page, as a checkable fact.
 *
 * The reel used to be the FlatList's `ListHeaderComponent`, which puts it
 * INSIDE the scroll content: scrolling to the third row of cameras scrolled the
 * recent events off the top. It is page chrome — a sibling above the list, in
 * the screen's flex column, exactly like `EventsScreen`'s filter bar sits above
 * its gallery.
 *
 * The marker below exists so that placement is asserted structurally rather
 * than by reading JSX: `src/screens/__tests__/cameras-reel-fixed.spec.ts`
 * mounts the screen and checks this list does not CONTAIN the reel block.
 * `testID` reaches the DOM as `data-testid` on web and is inert on a device.
 */

/** The scrolling camera list itself. The block's own marker is
 *  `RECENT_REEL_TEST_ID`, in `components/events/track/reel-layout.ts` — it
 *  belongs to the reel, and a component must not import upward from a screen. */
export const CAMERAS_LIST_TEST_ID = 'cameras-list'
