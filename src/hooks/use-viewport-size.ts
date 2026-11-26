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
  resolveViewportSize,
  type MeasuredSize,
  type ResolvedViewport,
  type ViewportReadout,
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
 * The hook face of `resolveViewportSize`: the last viewport that was NOT held
 * lives in a ref (per hook instance), is fed back in as `settled`, and is
 * rewritten after commit whenever the answer is not a hold.
 */
function useResolvedViewport(sources: ViewportHookSources): ResolvedViewport {
  const settled = useRef<MeasuredSize | null>(null)
  const { isWeb } = sources
  const { width: dw, height: dh } = sources.window
  const { width: fw, height: fh } = sources.frame
  const resolved = useMemo(
    () =>
      resolveViewportSize({
        isWeb,
        window: { width: dw, height: dh },
        frame: { width: fw, height: fh },
        settled: settled.current,
      }),
    [isWeb, dw, dh, fw, fh],
  )
  useLayoutEffect(() => {
    if (resolved.source !== 'held') settled.current = { width: resolved.width, height: resolved.height }
  }, [resolved])
  return resolved
}

export function useViewportSize(): ResolvedViewport {
  return useResolvedViewport(useViewportSources())
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
  const sources = useViewportSources()
  const viewport = useResolvedViewport(sources)
  const { isWeb } = sources
  const { width: dimWidth, height: dimHeight } = sources.window
  const { width: frameWidth, height: frameHeight } = sources.frame
  // Memoised on the numbers, not on the two objects: `useWindowDimensions` and
  // `useSafeAreaFrame` hand back fresh objects, and a diagnostic effect keyed
  // on this result must fire on a change of SHAPE, never on a render.
  return useMemo(() => {
    const readout = describeViewportSources({
      isWeb,
      window: { width: dimWidth, height: dimHeight },
      frame: { width: frameWidth, height: frameHeight },
    })
    return { viewport, readout: { ...readout, source: viewport.source } }
  }, [viewport, isWeb, dimWidth, dimHeight, frameWidth, frameHeight])
}
