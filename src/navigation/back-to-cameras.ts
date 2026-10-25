/** The Cameras tab — the one destination every stacked live surface backs out to. */
export const CAMERAS_TAB_HREF = '/cameras'

/**
 * The single method this module needs. Narrow on purpose: the real
 * `useRouter()` satisfies it, and so does a test double, without either side
 * having to know about typed-route unions.
 */
export interface CamerasBackRouter {
  readonly dismissTo: (href: typeof CAMERAS_TAB_HREF) => void
}

/**
 * Back out of a stacked screen (camera detail, grid wall) onto the Cameras tab.
 *
 * THREE things have to hold at once, and each one has already been shipped
 * broken:
 *
 * 1. It must not be a dead end. `router.back()` alone is a no-op when a
 *    notification deep-links straight to `/camera/<id>`: nothing to pop.
 * 2. The live surface underneath must not survive. Backing out of a camera
 *    opened from a grid tile used to leave the wall mounted below, streaming.
 * 3. The list we land on must be the one we left, at the offset we left it.
 *
 * `router.replace('/cameras')` buys 1 and 2 and loses 3. REPLACE does not
 * RETURN to the `(tabs)` route at the bottom of the stack — React Navigation's
 * stack router builds a brand new one (`createRouteFromAction`, fresh key) in
 * the slot the detail occupied, so a SECOND tab navigator mounts on top of the
 * first: new CamerasScreen, new FlatList, scroll back at the top. The stack
 * also grows by one route on every camera round-trip.
 *
 * `dismissTo` dispatches POP_TO instead, which keeps all three:
 * - the `(tabs)` route is found in the stack and popped back to BY KEY, so
 *   nothing above it survives (2) and nothing below it remounts (3);
 * - its params are updated to `{ screen: 'cameras' }`, which `useNavigationBuilder`
 *   re-consumes and forwards to the tab navigator, so the destination is still
 *   always Cameras;
 * - and when `(tabs)` is NOT in the stack — exactly the cold-start deep link —
 *   POP_TO falls back to replacing the current route, i.e. the old behaviour (1).
 *
 * See `@react-navigation/routers` StackRouter, cases 'REPLACE' and 'POP_TO',
 * and the behavioural proof in `__tests__/back-to-cameras.spec.ts`.
 */
export function backToCameras(router: CamerasBackRouter, forget?: () => void): void {
  // Backing out IS the operator saying they are done with this camera, so it
  // is one of the two gestures that clear the remembered one. Navigating away
  // to another tab is NOT — that is how "press Cameras and come back to where
  // I was" became impossible.
  forget?.()
  router.dismissTo(CAMERAS_TAB_HREF)
}
