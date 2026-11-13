/**
 * @vitest-environment jsdom
 *
 * "Pinch to zoom keeps resetting by itself" (operator, 2026-11-13): "zoom then
 * move, or often right after the first pinch".
 *
 * On a zoomed picture the double tap is the one USER gesture that writes the
 * identity transform (`doubleTapTarget` → `fit`). The recogniser that calls it
 * does not count taps: Gesture Handler's iOS tap handler increments its tap
 * count on every touches-began EVENT and has no notion of the pinch or the pan
 * running beside it. So the hook's own touch record is the only thing that can
 * say whether the two "taps" it was handed were two clean single-finger
 * touches. It could not: the record forgot a sequence after 250 ms while the
 * recogniser still linked two touches 300 ms apart, and it marked a pan only
 * past 12 pt while the pan moved the picture from 4 pt.
 *
 * Each case below is driven through the hook's real gesture handlers on a
 * controlled clock, and each one reset a 2x zoom to 1x before the fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useStreamZoom, type StreamZoom } from '../use-stream-zoom.js'
import { DOUBLE_TAP_MAX_DELAY_MS } from '../zoom-touch-sequence.js'
import type { StubGesture } from '../../testing/native-stubs/gesture-handler.js'

const fixedBox = (): number => 242

function mount() {
  return renderHook(() =>
    useStreamZoom({
      contentAspect: 16 / 9,
      fit: 'cover',
      viewport: { width: 400, heightFor: fixedBox },
    }),
  )
}

function child(zoom: StreamZoom, index: number): StubGesture {
  const composed = zoom.composeWith() as unknown as StubGesture
  const g = composed.__children[index]
  if (g === undefined) throw new Error(`no gesture at ${index}`)
  return g
}
function call(g: StubGesture, name: string, ...args: unknown[]): void {
  const h = g.__handlers[name] as ((...a: unknown[]) => unknown) | undefined
  if (h === undefined) throw new Error(`no ${name}`)
  h(...args)
}

/** The fingers, on the clock: every call stamps `Date.now()` at `atMs`. */
function fingers(zoom: () => StreamZoom) {
  const at = (atMs: number, fn: () => void): void => {
    vi.setSystemTime(atMs)
    act(fn)
  }
  return {
    down: (atMs: number, touches: number) =>
      at(atMs, () => call(child(zoom(), 2), 'onTouchesDown', { numberOfTouches: touches })),
    up: (atMs: number) => at(atMs, () => call(child(zoom(), 2), 'onTouchesUp', {})),
    pinch: (startMs: number, endMs: number, gestureScale: number) => {
      at(startMs, () =>
        call(child(zoom(), 0), 'onStart', { focalX: 200, focalY: 121, numberOfPointers: 2 }),
      )
      at(startMs + 1, () =>
        call(child(zoom(), 0), 'onUpdate', {
          scale: gestureScale,
          focalX: 200,
          focalY: 121,
          numberOfPointers: 2,
        }),
      )
      at(endMs, () => call(child(zoom(), 0), 'onEnd', {}, true))
    },
    /** A one-finger drag that moved the zoomed picture by `dx` pt. */
    nudge: (startMs: number, endMs: number, dx: number) => {
      at(startMs, () => call(child(zoom(), 1), 'onStart', {}))
      at(startMs + 1, () =>
        call(child(zoom(), 1), 'onUpdate', { translationX: dx, translationY: 0 }),
      )
      at(endMs, () => call(child(zoom(), 1), 'onEnd', {}, true))
    },
    /** What the screen's two-tap recogniser does on its `onEnd`. */
    doubleTap: (atMs: number) => at(atMs, () => zoom().doubleTapZoomAt(200, 121)),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a zoomed picture is not reset by touches that were not a double tap', () => {
  it('right after the first pinch: a touch landing past the old sequence gap', () => {
    const { result } = mount()
    const f = fingers(() => result.current)
    f.down(1_000, 1)
    f.down(1_010, 2)
    f.pinch(1_020, 1_300, 2)
    f.up(1_300)
    f.up(1_310)
    expect(result.current.scale.value).toBeCloseTo(2, 6)
    // The finger comes back to move the picture 270 ms later — inside the
    // recogniser's 300 ms window, so it is handed to the double tap.
    f.down(1_310 + 270, 1)
    f.up(1_310 + 270 + 90)
    f.doubleTap(1_310 + 270 + 90)
    expect(result.current.scale.value).toBeCloseTo(2, 6)
  })

  it('zoom then move: two short drags of the zoomed picture', () => {
    const { result } = mount()
    const f = fingers(() => result.current)
    f.down(1_000, 2)
    f.pinch(1_000, 1_400, 2)
    f.up(1_400)
    // Long after the pinch: two quick nudges, each under the tap's 24 pt.
    f.down(5_000, 1)
    f.nudge(5_020, 5_120, 8)
    f.up(5_120)
    f.down(5_120 + 150, 1)
    f.nudge(5_290, 5_350, 8)
    f.up(5_350)
    f.doubleTap(5_350)
    expect(result.current.scale.value).toBeCloseTo(2, 6)
  })

  it('zoom then move: a drag and then a tap past the old gap', () => {
    const { result } = mount()
    const f = fingers(() => result.current)
    f.down(1_000, 2)
    f.pinch(1_000, 1_400, 2)
    f.up(1_400)
    f.down(5_000, 1)
    f.nudge(5_020, 5_120, 8)
    f.up(5_120)
    f.down(5_120 + DOUBLE_TAP_MAX_DELAY_MS - 20, 1)
    f.up(5_120 + DOUBLE_TAP_MAX_DELAY_MS + 60)
    f.doubleTap(5_120 + DOUBLE_TAP_MAX_DELAY_MS + 60)
    expect(result.current.scale.value).toBeCloseTo(2, 6)
  })

  it('a real double tap — two clean single-finger touches — still returns to the whole picture', () => {
    const { result } = mount()
    const f = fingers(() => result.current)
    f.down(1_000, 2)
    f.pinch(1_000, 1_400, 2)
    f.up(1_400)
    f.down(5_000, 1)
    f.up(5_060)
    f.down(5_060 + 120, 1)
    f.up(5_240)
    f.doubleTap(5_240)
    expect(result.current.scale.value).toBe(1)
  })

  it('a real double tap at 1x still zooms in', () => {
    const { result } = mount()
    const f = fingers(() => result.current)
    f.down(5_000, 1)
    f.up(5_060)
    f.down(5_180, 1)
    f.up(5_240)
    f.doubleTap(5_240)
    expect(result.current.scale.value).toBeGreaterThan(1)
  })
})
