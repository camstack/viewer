/**
 * Which measurement the app calls "the window".
 *
 * Two sources exist on native and they disagreed on the tablet on 2026-09-09
 * and 2026-09-10 (`detail-rotation-source.spec.ts` carries the numbers):
 * `Dimensions.window`, refreshed by a notification, and the safe-area frame,
 * measured by the provider view's own layout pass. The rule here is the whole
 * decision; the hook (`use-viewport-size.ts`) only feeds it.
 */
import { describe, expect, it } from 'vitest'

import { resolveViewportSize } from '../viewport-size.js'

const PORTRAIT = { width: 834, height: 1194 }
const LANDSCAPE = { width: 1194, height: 834 }

describe('resolveViewportSize', () => {
  it('native: the measured frame wins over the window', () => {
    const resolved = resolveViewportSize({ isWeb: false, window: PORTRAIT, frame: LANDSCAPE })
    expect(resolved).toEqual({ width: 1194, height: 834, source: 'frame' })
  })

  it('native: a frame that has not laid out yet (0×0) is not a measurement', () => {
    const resolved = resolveViewportSize({
      isWeb: false,
      window: LANDSCAPE,
      frame: { width: 0, height: 0 },
    })
    expect(resolved).toEqual({ width: 1194, height: 834, source: 'window' })
  })

  it('native: a frame with one degenerate side is refused whole', () => {
    // Half a measurement is the input `resolveDetailLayoutMode` reads as
    // "degenerate, stack" — better the window than a 1194×0 viewport.
    const resolved = resolveViewportSize({
      isWeb: false,
      window: LANDSCAPE,
      frame: { width: 1194, height: Number.NaN },
    })
    expect(resolved.source).toBe('window')
  })

  it('native: no frame at all falls back to the window', () => {
    const resolved = resolveViewportSize({ isWeb: false, window: LANDSCAPE, frame: null })
    expect(resolved).toEqual({ width: 1194, height: 834, source: 'window' })
  })

  it('web: the window is the surface, whatever the frame says', () => {
    // `NativeSafeAreaProvider.web` reads the document once at mount and on a
    // transition end; a resized browser window would leave it stale.
    const resolved = resolveViewportSize({ isWeb: true, window: LANDSCAPE, frame: PORTRAIT })
    expect(resolved).toEqual({ width: 1194, height: 834, source: 'window' })
  })
})
