/**
 * GridTapDismiss — the invisible layer that turns a tap on the grid body into a
 * dismissal of whatever is open.
 *
 * Mounted by `GridViewScreen` as a SIBLING of the wall and BELOW the control
 * bar, so:
 *   • while it is mounted it is the top of the wall's subtree and the tap is
 *     consumed — it never reaches a tile, an embed cell or the wall's gestures,
 *     which is what keeps "dismiss" from also opening a camera;
 *   • the bar, its popover and the cell/share backdrops paint above it and stay
 *     hittable, so the operator can still work the control that is open;
 *   • when nothing is open it is not rendered at all, so pinch, long-press and
 *     the in-tile controls are exactly what they were.
 *
 * Whether it is mounted, and whether a given press counts, are both decided in
 * `grid/panel-dismiss` — a drag across an absolutely-positioned scrim never
 * leaves its bounds, so `Pressable` alone would report every scrub as a press.
 */
import React, { useRef } from 'react'
import { Pressable, StyleSheet, type GestureResponderEvent } from 'react-native'
import { isDismissTap, type DismissTapPoint } from '../../grid/panel-dismiss.js'

/** Test hook — the scrim is transparent and has nothing else to find it by. */
export const GRID_TAP_DISMISS_TEST_ID = 'grid-tap-dismiss'

export interface GridTapDismissProps {
  /** Render the layer at all. False ⇒ nothing is mounted (see the docblock). */
  readonly active: boolean
  /** Close everything that is open. Called once, on a press that reads as a tap. */
  readonly onDismiss: () => void
  /** Localized label for the layer (screen readers announce a close action). */
  readonly accessibilityLabel: string
}

function pointOf(e: GestureResponderEvent): DismissTapPoint {
  return {
    x: e.nativeEvent.pageX,
    y: e.nativeEvent.pageY,
    t: e.nativeEvent.timestamp,
  }
}

export function GridTapDismiss({
  active,
  onDismiss,
  accessibilityLabel,
}: GridTapDismissProps): React.JSX.Element | null {
  // Where the press started, and the verdict the release produced. Refs, not
  // state: they are read within the SAME gesture and must never cause a render —
  // a layer that re-renders mid-gesture is a layer that can drop the release.
  //
  // The dismissal itself fires on `onPress`, the accessible, platform-blessed
  // "this was activated" — keyboard and assistive activation included, neither
  // of which has endpoints. `onPressIn`/`onPressOut` only ANNOTATE it, so an
  // activation with no measured press still dismisses (the default below).
  const downRef = useRef<DismissTapPoint | null>(null)
  const wasTapRef = useRef(true)

  if (!active) return null

  return (
    <Pressable
      testID={GRID_TAP_DISMISS_TEST_ID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={StyleSheet.absoluteFill}
      onPressIn={(e) => {
        downRef.current = pointOf(e)
        wasTapRef.current = true
      }}
      onPressOut={(e) => {
        const down = downRef.current
        downRef.current = null
        wasTapRef.current = down === null || isDismissTap(down, pointOf(e))
      }}
      onPress={() => {
        if (wasTapRef.current) onDismiss()
        wasTapRef.current = true
      }}
    />
  )
}
