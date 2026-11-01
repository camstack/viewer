/**
 * ResizeHandle — the drag bar between the Library timeline and its stills.
 *
 * One component for both arrangements: `axis="y"` is the bar under the phone's
 * strip (drag down to expand), `axis="x"` the bar on the left edge of the
 * tablet/desktop column (drag left to widen). It reports the TOTAL travel since
 * the gesture began, signed so that growing the stills is positive, and says
 * when the gesture ends; clamping and snapping are `library-layout.ts`'s.
 */
import React, { useMemo, useRef } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'

import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'

export interface ResizeHandleProps {
  readonly axis: 'x' | 'y'
  readonly onStart: () => void
  /** Total travel since the start, positive = the stills grow. */
  readonly onDrag: (travel: number) => void
  readonly onEnd: () => void
  readonly testID: string
}

/** Thickness of the touch target (pt). */
const HIT = SPACING['2xl']

export function ResizeHandle({ axis, onStart, onDrag, onEnd, testID }: ResizeHandleProps): React.JSX.Element {
  const { colors } = useTheme()
  const cb = useRef({ onStart, onDrag, onEnd })
  cb.current = { onStart, onDrag, onEnd }

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => cb.current.onStart(),
        onPanResponderMove: (_e, g) => cb.current.onDrag(axis === 'y' ? g.dy : -g.dx),
        onPanResponderRelease: () => cb.current.onEnd(),
        onPanResponderTerminate: () => cb.current.onEnd(),
      }),
    [axis],
  )

  return (
    <View
      testID={testID}
      {...responder.panHandlers}
      style={[axis === 'y' ? styles.bar : styles.side, { backgroundColor: colors.background }]}
    >
      <View style={[axis === 'y' ? styles.gripY : styles.gripX, { backgroundColor: colors.border }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { height: HIT, width: '100%', alignItems: 'center', justifyContent: 'center' },
  side: { width: HIT, alignItems: 'center', justifyContent: 'center' },
  gripY: { width: 40, height: 4, borderRadius: RADIUS.pill },
  gripX: { width: 4, height: 40, borderRadius: RADIUS.pill },
})
