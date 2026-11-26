/**
 * `useViewportSize` — the ONE hook a layout decision reads the window through.
 *
 * `viewport-size.ts` holds the rule and the incident. This is its React face:
 * `useWindowDimensions()` for the notification-driven value, `useSafeAreaFrame()`
 * for the view-tree measurement, `Platform.OS` to say which is the surface.
 *
 * Every former `useWindowDimensions()` call site in `src/` reads this instead,
 * so a screen and the components inside it can never lay out from two
 * different windows — the exact split the tablet showed on 2026-09-10, when the
 * theater's gate read a portrait window inside a landscape root.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Platform, useWindowDimensions } from 'react-native'
import { useSafeAreaFrame } from 'react-native-safe-area-context'

import {
  describeViewportSources,
  isCoherentViewport,
  resolveViewportSize,
  type MeasuredSize,
  type ResolvedViewport,
  type ViewportReadout,
  type ViewportSizeInput,
} from './viewport-size.js'

export type { ResolvedViewport, ViewportReadout, ViewportSource } from './viewport-size.js'

/** The hook's inputs: unlike {@link ViewportSizeInput}, the frame is always
 *  there — `useSafeAreaFrame` throws outside a provider rather than answering
 *  `null`, and the app mounts one at its root. */
interface ViewportHookSources {
  readonly isWeb: boolean
  readonly window: MeasuredSize
  readonly frame: MeasuredSize
}

function useViewportSources(): ViewportHookSources {
  const window = useWindowDimensions()
  const frame = useSafeAreaFrame()
  return { isWeb: Platform.OS === 'web', window, frame }
}

/**
 * The last viewport both sources agreed on, per hook instance. Written after
 * commit, read on the next render: a pure input to `resolveViewportSize`.
 */
function useSettledViewport(resolved: ResolvedViewport, coherent: boolean): MeasuredSize | null {
  const settled = useRef<MeasuredSize | null>(null)
  const { width, height } = resolved
  useLayoutEffect(() => {
    if (coherent) settled.current = { width, height }
  }, [coherent, width, height])
  return settled.current
}

export function useViewportSize(): ResolvedViewport {
  const sources = useViewportSources()
  const { width: dw, height: dh } = sources.window
  const { width: fw, height: fh } = sources.frame
  const settled = useSettledViewport(
    resolveViewportSize(sources),
    sources.isWeb || isCoherentViewport({ width: dw, height: dh }, { width: fw, height: fh }),
  )
  return useMemo(
    () =>
      resolveViewportSize({
        isWeb: sources.isWeb,
        window: { width: dw, height: dh },
        frame: { width: fw, height: fh },
        settled,
      }),
    [sources.isWeb, dw, dh, fw, fh, settled],
  )
}

/** The resolved viewport AND its raw sources — for the theater's trace. */
export interface ViewportReadoutResult {
  readonly viewport: ResolvedViewport
  readonly readout: ViewportReadout
}

/**
 * Same answer as {@link useViewportSize}, plus the two raw sources it was
 * resolved from. Only a diagnostic wants the raw pair; everything that lays
 * out reads the resolved one and nothing else.
 */
export function useViewportReadout(): ViewportReadoutResult {
  const { isWeb, window, frame } = useViewportSources()
  const { width: dimWidth, height: dimHeight } = window
  const { width: frameWidth, height: frameHeight } = frame
  // Memoised on the numbers, not on the two objects: `useWindowDimensions` and
  // `useSafeAreaFrame` hand back fresh objects, and a diagnostic effect keyed
  // on this result must fire on a change of SHAPE, never on a render.
  const coherent =
    isWeb ||
    isCoherentViewport(
      { width: dimWidth, height: dimHeight },
      { width: frameWidth, height: frameHeight },
    )
  const base: ViewportSizeInput = {
    isWeb,
    window: { width: dimWidth, height: dimHeight },
    frame: { width: frameWidth, height: frameHeight },
  }
  const settled = useSettledViewport(resolveViewportSize(base), coherent)
  return useMemo(() => {
    const sources: ViewportSizeInput = { ...base, settled }
    const viewport = resolveViewportSize(sources)
    return { viewport, readout: describeViewportSources(sources) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `base` is built from the listed numbers
  }, [isWeb, dimWidth, dimHeight, frameWidth, frameHeight, settled])
}
