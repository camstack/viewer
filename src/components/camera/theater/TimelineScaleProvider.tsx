/**
 * Publishes the width-derived timeline tokens to the whole subtree.
 *
 * The container is the only thing that knows how much width it has, and every
 * descendant needs to size itself from it. A context rather than a prop because
 * the alternative — threading `compact` through TheaterTimeline into the toolbar
 * and the transport controls, and through whatever is added next — is precisely
 * the hand-scaling this replaces: a new component that forgets the prop renders
 * at full size and nothing catches it.
 *
 * The default is {@link FULL_SIZE_TOKENS}, so a component used OUTSIDE any
 * provider (the portrait timeline, the grid) is unchanged.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  FULL_SIZE_TOKENS,
  timelineTokens,
  type TimelineScaleTokens,
  type ToolbarDensity,
} from './timeline-scale-tokens.js'

const TimelineScaleContext = createContext<TimelineScaleTokens>(FULL_SIZE_TOKENS)

export interface TimelineScaleProviderProps {
  /** The width the subtree actually has to render into (pt). */
  readonly availableWidth: number
  /** Operator's toolbar-height preference. Omitted ⟺ `small`, which is what
   *  shipped — nobody's toolbar changes until they ask. */
  readonly density?: ToolbarDensity
  readonly children: ReactNode
}

export function TimelineScaleProvider({
  availableWidth,
  density,
  children,
}: TimelineScaleProviderProps): React.JSX.Element {
  const tokens = useMemo(
    () => timelineTokens(availableWidth, density),
    [availableWidth, density],
  )
  return <TimelineScaleContext.Provider value={tokens}>{children}</TimelineScaleContext.Provider>
}

/** Tokens for the current container. Full-size outside a provider. */
export function useTimelineScale(): TimelineScaleTokens {
  return useContext(TimelineScaleContext)
}
