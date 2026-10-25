/**
 * stream-slot — the box `TheaterTimeline` puts the PLAYER in, per layout shape.
 *
 * ## Why this is a module and not a ternary
 *
 * The slot is index 1 of the timeline's column and the player's ONE parent in
 * every layout — that is what keeps a rotation from re-parenting (and therefore
 * remounting, and therefore renegotiating) the WebRTC session. See the `stream`
 * prop's docblock for the two shapes that failed the other way round.
 *
 * It was styled `shape === 'wide' ? styles.wideStreamColumn : null`. A `null`
 * style is a View with no flex and no height, and in `fill` its only child is
 * `videoWrapFull` — `StyleSheet.absoluteFill`, out of flow — so the slot
 * measured **900x0 on a 900x500 window** (browser-verified 2026-08-08). The
 * picture still appeared only because the SCREEN also writes an animated
 * `height` onto the player: the box was being supplied by an animation rather
 * than by the layout. Everything else derived from the slot — the recorded
 * `<canvas>` fit box drawn over the `<video>`, the gesture catcher, the
 * zone-draw overlay — was sizing against zero until that animation landed, and
 * a stale animated height (this file's history has two) leaves it there.
 *
 * So every shape gets an explicit box, and a new shape cannot be added without
 * choosing one.
 */
import type { ViewStyle } from 'react-native'
import type { DetailLayoutMode } from '../../../screens/camera-detail/detail-layout.js'

/**
 * The picture's stacking order among the timeline column's children.
 *
 * It belongs on the SLOT, not on the player. `videoWrapFull` carried a
 * `zIndex: 50` intended to rank the picture above the timeline chrome, but once
 * the player moved inside the slot that number only ranks it against its own
 * siblings — of which it has none. The comparison that decides whether the
 * landscape drawer is visible is slot vs `DRAWER_OVERLAY_Z`, and it is asserted
 * in `stream-slot.spec`.
 */
export const STREAM_SLOT_Z = 50

/**
 * `fill` — the picture owns the window; the chrome floats over it in the
 * landscape drawer (absolutely positioned, so nothing else is in flow here).
 * `wide` — the picture column, beside the timeline rail.
 * `stack` — plain flow under the toolbar: the portrait layout that rendered
 * correctly for years and that nothing here may change.
 *
 * `chromeHidden` is the OFF state of the timeline toggle, and it is a state of
 * this slot rather than the absence of a sibling — see
 * `TheaterTimelineProps.chromeHidden` for why the chrome may never be
 * unmounted. `wide` needs nothing: the rail is out of flow and `flex: 1`
 * already takes the row. `stack` does: its slot is sized by its CHILD, so with
 * the column below it gone the picture would keep its old height and leave the
 * rest of the window empty.
 */
export function streamSlotStyle(shape: DetailLayoutMode, chromeHidden = false): ViewStyle {
  switch (shape) {
    case 'fill':
      return { flex: 1, minHeight: 0, zIndex: STREAM_SLOT_Z }
    case 'wide':
      return { flex: 1, minWidth: 0, alignItems: 'center' }
    case 'stack':
      return chromeHidden ? { width: '100%', flex: 1, minHeight: 0 } : { width: '100%' }
  }
}
