/**
 * ondemand-insets — what the floating player must stay clear of on the route
 * the operator is on right now.
 *
 * The player is hosted at the app root, ABOVE every route, so it knows nothing
 * of the bars the route beneath it draws. Without this it would rest over the
 * floating tab capsule, the home bar or the side rail — covering exactly the
 * controls the operator navigates with, which is what "the app under it stays
 * usable" has to mean for the corners too, not only for the touches.
 *
 * Pure: the route's bar kind, the layout flags and the safe-area insets come in
 * as values, and the numbers come from the SAME metric modules the bars are
 * laid out with — a second opinion about a bar's height is how this drifts.
 */
import { barKindForPath, homeBarHeight, homeBarVariant } from '../navigation/bar-kind.js'
import { bottomNavFootprint } from '../navigation/bottom-nav-metrics.js'
import { sideNavFootprint } from '../navigation/side-nav-metrics.js'
import {
  HEADER_BUTTON_SIZE,
  HEADER_PADDING_BOTTOM,
  HEADER_PADDING_TOP,
} from '../components/screen-header-metrics.js'
import type { OnDemandInsets } from './ondemand-geometry.js'

export interface OnDemandInsetsInput {
  readonly pathname: string
  /** `useSafeAreaInsets()`. */
  readonly safe: OnDemandInsets
  /** `useSidebarLayout()` — the rail replaces the bottom capsule. */
  readonly showSidebar: boolean
  readonly compactSidebar: boolean
}

/** An inner page's own header: its button row plus the padding around it. */
const INNER_HEADER_HEIGHT = HEADER_PADDING_TOP + HEADER_BUTTON_SIZE + HEADER_PADDING_BOTTOM

export function onDemandInsets({
  pathname,
  safe,
  showSidebar,
  compactSidebar,
}: OnDemandInsetsInput): OnDemandInsets {
  const kind = barKindForPath(pathname)
  const variant = homeBarVariant({ showSidebar, compact: compactSidebar })
  const topBar =
    kind === 'home' ? homeBarHeight(variant) : kind === 'inner' ? INNER_HEADER_HEIGHT : 0
  // Only the tab roots wear the bottom capsule (phone) or the rail (wide). A
  // picture route and an inner page draw neither, so they spend only the safe
  // area at those edges.
  const onTabs = kind === 'home'
  return {
    top: safe.top + topBar,
    right: safe.right,
    bottom: onTabs ? Math.max(safe.bottom, bottomNavFootprint({ visible: !showSidebar, insetBottom: safe.bottom })) : safe.bottom,
    left: onTabs && showSidebar ? sideNavFootprint({ visible: true, insetLeft: safe.left }) : safe.left,
  }
}
