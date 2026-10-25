/**
 * Safe-area insets under test. A FIXED non-zero top inset on purpose: a screen
 * that double-applies the inset, or forgets it, is a real defect this repo has
 * shipped, and a zero inset would make both invisible.
 *
 * The FRAME is steerable, not fixed: it is the measurement `useViewportSize()`
 * reads ahead of `Dimensions` on a device, so a stub answering a constant
 * would make the one report this exists for (`hooks/viewport-size.ts`)
 * unreproducible. `setTestViewport` (`../viewport-control.ts`) sets it; until
 * then it is `null` and the hook falls back to the window.
 */
import React, { useSyncExternalStore } from 'react'
import { View, type ViewProps } from 'react-native'

import { currentTestFrame, subscribeTestFrame } from '../viewport-control.js'

export interface EdgeInsets {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const TEST_INSETS: EdgeInsets = { top: 47, bottom: 34, left: 0, right: 0 }

const SafeAreaInsetsContext = React.createContext<EdgeInsets | null>(TEST_INSETS)

export function useSafeAreaInsets(): EdgeInsets {
  return React.useContext(SafeAreaInsetsContext) ?? TEST_INSETS
}

/** A frame nobody has set: 0×0, which `resolveViewportSize` refuses. */
const UNSET_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 }

export function useSafeAreaFrame(): Rect {
  const frame = useSyncExternalStore(subscribeTestFrame, currentTestFrame, currentTestFrame)
  return frame === null ? UNSET_FRAME : { x: 0, y: 0, width: frame.width, height: frame.height }
}

export function SafeAreaProvider({ children }: ViewProps): React.ReactElement {
  return <View>{children}</View>
}

export const SafeAreaView = ({ children, style }: ViewProps): React.ReactElement => (
  <View style={style}>{children}</View>
)

export const initialWindowMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: TEST_INSETS,
}

export { SafeAreaInsetsContext }
