/**
 * @vitest-environment jsdom
 *
 * The live zoom hook, driven by hand through the gesture stub.
 *
 * Two things the operator's "scattoso, torna indietro durante i tap" came
 * down to, and both are facts about THIS hook's contract rather than about
 * the arithmetic (`zoom-steps`, `stream-zoom-clamp` pin that separately):
 *
 * 1. The result the hook hands the screen must be the SAME object across
 *    re-renders. The screen builds its gesture tree in a `useMemo` keyed on it;
 *    a fresh object per render rebuilt five gestures per render, and Gesture
 *    Handler then reconfigured five native handlers and re-shipped every
 *    worklet to the UI thread each time the screen re-rendered — which it does
 *    on every playhead tick. Neither the hook nor the screen is compiled by the
 *    React Compiler (both bail out), so this memo is the only one there is.
 *
 * 2. The hook never measures. The box's height is a rule the SCREEN owns
 *    (`viewport.heightFor(scale)`), evaluated on the LIVE scale: the box grows
 *    under the fingers, the clamp is against the box of THIS frame, and the
 *    growth is folded into the transform so the player's frame never changes.
 *    Nothing moves at the release. The two earlier designs both failed here —
 *    a box measured back through `onLayout` (the WKWebView re-laid-out every
 *    frame), then a box that grew AFTER the release (the picture kept going
 *    once the fingers had lifted: "continua a ritornare in avanti").
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { setLogVerbose, useLogStore } from '../../lib/logger.js'
import { useStreamZoom, type StreamZoom } from '../use-stream-zoom.js'
import { streamPanExtent } from '../stream-zoom-clamp.js'
import { focalPan } from '../zoom-steps.js'
import { foldGrowth } from '../zoom-render.js'
import type { StubGesture } from '../../testing/native-stubs/gesture-handler.js'

const ASPECT = 16 / 9
const WIDTH = 400
/** A "growing panel": 200pt at rest, 400pt once the committed scale passes 1.5. */
const growingBox = (committedScale: number): number => (committedScale > 1.5 ? 400 : 200)
const fixedBox = (): number => 242

interface PinchEvent {
  readonly scale: number
  readonly focalX: number
  readonly focalY: number
  readonly numberOfPointers: number
}
interface PinchDriver {
  start(focalX: number, focalY: number): void
  update(e: PinchEvent): void
  end(): void
}

/** The pinch is the first member of `composeWith`'s `Simultaneous`. */
function pinchOf(zoom: StreamZoom): PinchDriver {
  const composed = zoom.composeWith() as unknown as StubGesture
  const pinch = composed.__children[0]
  if (pinch === undefined) throw new Error('composeWith() did not compose a pinch')
  const call = (name: string, ...args: unknown[]): void => {
    const handler = pinch.__handlers[name] as ((...a: unknown[]) => unknown) | undefined
    if (handler === undefined) throw new Error(`pinch has no ${name} handler`)
    handler(...args)
  }
  return {
    start: (focalX, focalY) => call('onStart', { focalX, focalY, scale: 1, numberOfPointers: 2 }),
    update: (e) => call('onUpdate', e),
    end: () => call('onEnd', {}, true),
  }
}

interface Transform {
  readonly scale: number
  readonly tx: number
  readonly ty: number
}
type TransformEntry = Readonly<Record<string, number>>
/** Under the stub `useAnimatedStyle` hands back the plain style the factory built. */
function hasTransform(style: unknown): style is { readonly transform: readonly TransformEntry[] } {
  return typeof style === 'object' && style !== null && Array.isArray((style as { transform?: unknown }).transform)
}
/** The RENDER transform the wrapper is drawn with, read back from `videoStyle`. */
function renderOf(zoom: StreamZoom): Transform {
  const style: unknown = zoom.videoStyle
  if (!hasTransform(style)) throw new Error('videoStyle carries no transform')
  const find = (key: string): number => {
    const entry = style.transform.find((t) => key in t)
    return entry === undefined ? Number.NaN : entry[key]
  }
  return { scale: find('scale'), tx: find('translateX'), ty: find('translateY') }
}
/** The LOGICAL transform (pinch scale + pan), unfolded from the render transform. */
function transformOf(zoom: StreamZoom, heightFor: (s: number) => number): Transform {
  const r = renderOf(zoom)
  const s = zoom.scale.value
  const h = heightFor(s)
  const rest = heightFor(1)
  const expected = foldGrowth({ scale: s, tx: r.tx, ty: r.ty - (h - rest) / 2, boxHeight: h, restHeight: rest })
  // The render transform must be exactly the fold of the logical one.
  expect(r.scale).toBeCloseTo(expected.scale, 6)
  return { scale: s, tx: r.tx, ty: r.ty - (h - rest) / 2 }
}

/** What the focal rule asks for from a corner tap/pinch, clamped in a FIXED box `h` tall. */
function cornerPan(h: number, scaleAfter: number): { x: number; y: number } {
  const lim = streamPanExtent(WIDTH, h, ASPECT, scaleAfter, 'cover')
  const want = (center: number): number =>
    focalPan({ focalNow: 0, focalStart: 0, center, panStart: 0, scaleStart: 1, scaleAfter })
  return {
    x: Math.max(-lim.x, Math.min(lim.x, want(WIDTH / 2))),
    y: Math.max(-lim.y, Math.min(lim.y, want(h / 2))),
  }
}
/** The same, from a corner, in the GROWING box: the centre moves and the total
 *  scale is pinch × growth — computed with the same pure helpers the hook uses. */
function cornerGrowPan(scaleStart: number, scaleAfter: number): { x: number; y: number } {
  const h0 = growingBox(scaleStart)
  const h1 = growingBox(scaleAfter)
  const lim = streamPanExtent(WIDTH, h1, ASPECT, scaleAfter, 'cover')
  const want = (center: number, centerAfter: number): number =>
    focalPan({
      focalNow: 0,
      focalStart: 0,
      center,
      centerAfter,
      panStart: 0,
      scaleStart: scaleStart * h0,
      scaleAfter: scaleAfter * h1,
    })
  return {
    x: Math.max(-lim.x, Math.min(lim.x, want(WIDTH / 2, WIDTH / 2))),
    y: Math.max(-lim.y, Math.min(lim.y, want(h0 / 2, h1 / 2))),
  }
}

function mount(heightFor: (s: number) => number, trace = false) {
  return renderHook(() =>
    useStreamZoom({ contentAspect: ASPECT, fit: 'cover', viewport: { width: WIDTH, heightFor }, trace }),
  )
}

describe('useStreamZoom — one result, one viewport', () => {
  it('hands the screen the SAME result across re-renders (the gesture tree is keyed on it)', () => {
    const { result, rerender } = mount(fixedBox)
    const first = result.current
    rerender()
    rerender()
    expect(result.current).toBe(first)
    expect(result.current.composeWith).toBe(first.composeWith)
    expect(result.current.doubleTapZoomAt).toBe(first.doubleTapZoomAt)
  })

  it('grows the box under the fingers: the clamp and the anchor are those of the box the LIVE scale asks for', () => {
    const { result, rerender } = mount(growingBox)
    const pinch = pinchOf(result.current)
    // Pinch in from the top-left corner: the focal maths pushes the pan hard
    // toward the limit on both axes, so the limit is what we read back.
    act(() => {
      pinch.start(0, 0)
      pinch.update({ scale: 2, focalX: 0, focalY: 0, numberOfPointers: 2 })
    })
    rerender()
    // Mid-gesture the committed scale is still 1, but the box is the 400pt one
    // the live scale asks for: the centre moved from 100 to 200 and the total
    // scale is 2 × (400/200). Against the rest box the same gesture would land
    // the picture at ty = 100, not 200.
    expect(result.current.committedScale.value).toBe(1)
    const want = cornerGrowPan(1, 2)
    const wrong = cornerPan(growingBox(1), 2)
    expect(want.y).not.toBeCloseTo(wrong.y, 6)
    const t = transformOf(result.current, growingBox)
    expect(t.scale).toBe(2)
    expect(t.tx).toBeCloseTo(want.x, 6)
    expect(t.ty).toBeCloseTo(want.y, 6)
    // And the render transform carries the growth: 2 × 400/200 about the box centre.
    expect(renderOf(result.current).scale).toBeCloseTo(4, 6)
    expect(renderOf(result.current).ty).toBeCloseTo(t.ty + (400 - 200) / 2, 6)
  })

  it('a pinch-OUT shrinks the box under the fingers, the pan stays inside it at every frame, and NOTHING moves at the release', () => {
    const { result, rerender } = mount(growingBox)
    const pinch = pinchOf(result.current)
    // Commit 3x about the centre: box grows to 400.
    act(() => {
      pinch.start(WIDTH / 2, growingBox(1) / 2)
      pinch.update({ scale: 3, focalX: WIDTH / 2, focalY: growingBox(1) / 2, numberOfPointers: 2 })
      pinch.end()
    })
    expect(result.current.committedScale.value).toBe(3)
    // Pinch out to 1.2x from the corner: the box is the SHORT one already
    // during the gesture, and the pan is clamped to it.
    act(() => {
      pinch.start(0, 0)
      pinch.update({ scale: 0.4, focalX: 0, focalY: 0, numberOfPointers: 2 })
    })
    rerender()
    const during = transformOf(result.current, growingBox)
    const shortLim = streamPanExtent(WIDTH, growingBox(1.2), ASPECT, 1.2, 'cover')
    expect(Math.abs(during.tx)).toBeLessThanOrEqual(shortLim.x + 1e-6)
    expect(Math.abs(during.ty)).toBeLessThanOrEqual(shortLim.y + 1e-6)
    const renderDuring = renderOf(result.current)
    // Release: the picture is drawn EXACTLY as in the last frame of the gesture.
    act(() => {
      pinch.end()
    })
    rerender()
    expect(result.current.committedScale.value).toBeCloseTo(1.2, 6)
    expect(renderOf(result.current)).toEqual(renderDuring)
  })

  it('at the MAXIMUM, spreading the fingers further changes nothing — and neither does letting go', () => {
    const { result, rerender } = mount(growingBox)
    const pinch = pinchOf(result.current)
    act(() => {
      pinch.start(100, 60)
      pinch.update({ scale: 4, focalX: 100, focalY: 60, numberOfPointers: 2 })
    })
    rerender()
    const atMax = renderOf(result.current)
    act(() => {
      pinch.update({ scale: 6, focalX: 100, focalY: 60, numberOfPointers: 2 })
      pinch.update({ scale: 9, focalX: 100, focalY: 60, numberOfPointers: 2 })
    })
    rerender()
    expect(renderOf(result.current)).toEqual(atMax)
    act(() => {
      pinch.end()
    })
    rerender()
    expect(renderOf(result.current)).toEqual(atMax)
    expect(result.current.committedScale.value).toBe(4)
  })

  it('ignores a pinch update once a finger has lifted — the focal would jump onto the finger left', () => {
    const { result, rerender } = mount(fixedBox)
    const pinch = pinchOf(result.current)
    act(() => {
      pinch.start(200, 100)
      pinch.update({ scale: 2, focalX: 200, focalY: 100, numberOfPointers: 2 })
      pinch.update({ scale: 2.5, focalX: 40, focalY: 10, numberOfPointers: 1 })
    })
    rerender()
    expect(transformOf(result.current, fixedBox).scale).toBe(2)
  })

  it('double tap from the whole picture in a cover box: the fallback step, anchored; again: back to fit', () => {
    const { result, rerender } = mount(growingBox)
    // Plain call: under the stub a worklet is a function, and on the device it
    // is what the tap gesture's `onEnd` calls without `runOnJS`. A cover box
    // already fills the player, so there are no bars to remove: the first
    // fixed step instead.
    act(() => {
      result.current.doubleTapZoomAt(0, 0)
    })
    rerender()
    expect(result.current.committedScale.value).toBe(2)
    const t = transformOf(result.current, growingBox)
    expect(t.scale).toBe(2)
    // Anchored on the tap (top-left corner), across the growth the step causes.
    const want = cornerGrowPan(1, 2)
    expect(t.tx).toBeCloseTo(want.x, 6)
    expect(t.ty).toBeCloseTo(want.y, 6)
    // Zoomed in by any amount: the next double tap is the whole picture.
    act(() => {
      result.current.doubleTapZoomAt(0, 0)
    })
    rerender()
    expect(result.current.committedScale.value).toBe(1)
    expect(transformOf(result.current, growingBox)).toEqual({ scale: 1, tx: 0, ty: 0 })
  })

  it('double tap from the whole picture in a letterboxing box: the scale that fills it, at the tap', () => {
    // 400×150 box, 16:9 picture: pillarboxed; filling it takes (400/150)/(16/9) = 1.5.
    const wideBox = (): number => 150
    const { result, rerender } = renderHook(() =>
      useStreamZoom({ contentAspect: ASPECT, fit: 'contain', viewport: { width: WIDTH, heightFor: wideBox } }),
    )
    act(() => {
      result.current.doubleTapZoomAt(300, 40)
    })
    rerender()
    const cover = WIDTH / 150 / ASPECT
    expect(result.current.committedScale.value).toBeCloseTo(cover, 9)
    const t = transformOf(result.current, wideBox)
    const lim = streamPanExtent(WIDTH, 150, ASPECT, cover, 'contain')
    const anchored = (tap: number, center: number): number =>
      focalPan({ focalNow: tap, focalStart: tap, center, panStart: 0, scaleStart: 1, scaleAfter: cover })
    // At cover the picture exactly fills the width: no horizontal travel, so
    // the anchor is clamped to the centre on x and honoured on y.
    expect(lim.x).toBeCloseTo(0, 6)
    expect(t.tx).toBeCloseTo(0, 6)
    expect(t.ty).toBeCloseTo(Math.max(-lim.y, Math.min(lim.y, anchored(40, 75))), 6)
    expect(t.ty).not.toBe(0)
  })

  it('double tap after a pinch (any scale above the minimum) returns to fit', () => {
    vi.useFakeTimers()
    try {
      const { result, rerender } = mount(fixedBox)
      const pinch = pinchOf(result.current)
      act(() => {
        pinch.start(200, 100)
        pinch.update({ scale: 1.3, focalX: 200, focalY: 100, numberOfPointers: 2 })
        pinch.end()
      })
      // Past the bounce window that keeps a pinch's own release from counting.
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      act(() => {
        result.current.doubleTapZoomAt(50, 50)
      })
      rerender()
      expect(result.current.committedScale.value).toBe(1)
      expect(transformOf(result.current, fixedBox)).toEqual({ scale: 1, tx: 0, ty: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('snapZoom drops the transform and the commitment in one step', () => {
    const { result, rerender } = mount(growingBox)
    act(() => {
      result.current.doubleTapZoomAt(10, 10)
      result.current.snapZoom()
    })
    rerender()
    expect(result.current.committedScale.value).toBe(1)
    expect(transformOf(result.current, growingBox)).toEqual({ scale: 1, tx: 0, ty: 0 })
  })
})

/**
 * The trace is the operator's instrument: one log entry per gesture, written
 * after the settle window so the box's follow-through (reported by the screen
 * through `traceBox`) lands in the SAME entry as the pinch that caused it.
 * Off, nothing is written — the switch is the app's debug mode.
 */
describe('useStreamZoom — trace', () => {
  afterEach(() => {
    vi.useRealTimers()
    setLogVerbose(false)
    useLogStore.getState().clear()
  })

  const traceEntries = () =>
    useLogStore.getState().entries.filter((e) => e.scope === 'live:zoom' && e.msg.startsWith('zoom trace'))

  it('writes ONE readable entry per pinch, after the settle window, box follow-through included', () => {
    vi.useFakeTimers()
    setLogVerbose(true)
    const { result } = mount(growingBox, true)
    const pinch = pinchOf(result.current)
    act(() => {
      pinch.start(200, 100)
      pinch.update({ scale: 2, focalX: 200, focalY: 100, numberOfPointers: 2 })
      pinch.end()
      // The screen reports the box it draws, frame by frame (throttled to one
      // sample per 32 ms, so the clock must move between the two).
      result.current.traceBox(260)
      vi.advanceTimersByTime(40)
      result.current.traceBox(400)
    })
    expect(traceEntries()).toHaveLength(0)
    act(() => {
      vi.advanceTimersByTime(700)
    })
    const entries = traceEntries()
    expect(entries).toHaveLength(1)
    const lines = entries[0]?.msg.split('\n') ?? []
    expect(lines[0]).toMatch(/^zoom trace — pinch, 5 samples over \d+ ms$/)
    expect(lines.map((l) => l.trim().split(/\s+/)[1])).toEqual(['trace', 'start', 'update', 'end', 'box', 'box'])
    expect(lines[3]).toContain('box 200→400')
    expect(lines[4]).toContain('drawn 260 of 400 asked')
  })

  it('reports a trace still open when the next gesture begins, so nothing is lost to the window', () => {
    vi.useFakeTimers()
    setLogVerbose(true)
    const { result } = mount(fixedBox, true)
    const pinch = pinchOf(result.current)
    act(() => {
      pinch.start(200, 100)
      pinch.update({ scale: 2, focalX: 200, focalY: 100, numberOfPointers: 2 })
      pinch.end()
      pinch.start(200, 100)
    })
    expect(traceEntries()).toHaveLength(1)
  })

  it('writes nothing when tracing is off', () => {
    vi.useFakeTimers()
    setLogVerbose(true)
    const { result } = mount(growingBox, false)
    const pinch = pinchOf(result.current)
    act(() => {
      pinch.start(200, 100)
      pinch.update({ scale: 2, focalX: 200, focalY: 100, numberOfPointers: 2 })
      pinch.end()
      result.current.traceBox(400)
      vi.advanceTimersByTime(700)
    })
    expect(traceEntries()).toHaveLength(0)
  })
})
