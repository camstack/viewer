/**
 * A `TimelineScaleProvider` sized by the box it is actually in.
 *
 * The provider's own docblock is right — *"the container is the only thing
 * that knows how much width it has"* — and two of its three mounts told it
 * something else: the theater's `stack` branch handed it the whole WINDOW
 * width, so the playback bar believed it had room it did not have and drew a
 * tier that clipped. `playback-bar-fit.ts` was never the problem; its input
 * was.
 *
 * `availableWidth` stays as the ESTIMATE, used until the first layout pass, so
 * a first paint never renders the narrowest tier and then visibly grows.
 * The rule for accepting a measurement is `measured-scale-width.ts`.
 */
import React, { useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'

import { TimelineScaleProvider } from './TimelineScaleProvider.js'
import { measuredScaleBoxStyle, scaleWidthToUse, shouldAcceptScaleWidth } from './measured-scale-width.js'

export interface MeasuredTimelineScaleProps {
  /** What the caller believes the width is — used until the box reports. */
  readonly availableWidth: number
  readonly density: React.ComponentProps<typeof TimelineScaleProvider>['density']
  readonly children: React.ReactNode
  /**
   * The wrapper holds the timeline BODY and must be bounded by its parent —
   * see `measuredScaleBoxStyle`. Leave unset around a toolbar alone.
   */
  readonly fill?: boolean
}

export function MeasuredTimelineScale({
  availableWidth,
  density,
  children,
  fill = false,
}: MeasuredTimelineScaleProps): React.JSX.Element {
  const [measured, setMeasured] = useState<number | null>(null)

  const onLayout = (e: LayoutChangeEvent): void => {
    const next = e.nativeEvent.layout.width
    setMeasured((current) => (shouldAcceptScaleWidth(current, next) ? next : current))
  }

  return (
    <View onLayout={onLayout} style={measuredScaleBoxStyle(fill)}>
      <TimelineScaleProvider
        availableWidth={scaleWidthToUse(measured, availableWidth)}
        density={density}
      >
        {children}
      </TimelineScaleProvider>
    </View>
  )
}
