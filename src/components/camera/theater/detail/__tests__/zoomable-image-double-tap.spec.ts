/**
 * @vitest-environment jsdom
 *
 * The gallery picture's double tap steps a zoom ladder (1x -> 2x -> 3x -> 4x ->
 * 1x). Gesture Handler's tap recogniser counts touches-began EVENTS, so the two
 * fingers of a pinch, or two short drags of the zoomed picture, are "two taps"
 * to it. Without the touch record a quick pinch stepped the ladder, and from 4x
 * it went back to 1x. Each case is driven through the component's real gesture
 * handlers on a controlled clock.
 */
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StubGesture } from '../../../../../testing/native-stubs/gesture-handler.js'
import { ThemeProvider } from '../../../../../theme/theme-provider.js'
import { ZoomableImage } from '../ZoomableImage.js'

let composed: StubGesture | null = null

vi.mock('react-native-gesture-handler', async () => {
  const stub = await import('../../../../../testing/native-stubs/gesture-handler.js')
  return {
    ...stub,
    GestureDetector: ({ gesture, children }: { gesture: StubGesture; children: React.ReactNode }) => {
      composed = gesture
      return children
    },
  }
})

// Indices in `Gesture.Simultaneous(pinch, pan, doubleTap, touchTracker)`.
const PINCH = 0
const PAN = 1
const TAP = 2
const TRACKER = 3

function member(index: number): StubGesture {
  const g = composed?.__children[index]
  if (g === undefined) throw new Error(`no gesture at ${index}`)
  return g
}
function call(g: StubGesture, name: string, ...args: unknown[]): void {
  const h = g.__handlers[name] as ((...a: unknown[]) => unknown) | undefined
  if (h === undefined) throw new Error(`no ${name}`)
  h(...args)
}

const at = (atMs: number, fn: () => void): void => {
  vi.setSystemTime(atMs)
  act(fn)
}
const down = (atMs: number, touches: number): void =>
  at(atMs, () => call(member(TRACKER), 'onTouchesDown', { numberOfTouches: touches }))
const up = (atMs: number): void => at(atMs, () => call(member(TRACKER), 'onTouchesUp', {}))
const pinch = (startMs: number, endMs: number): void => {
  at(startMs, () => call(member(PINCH), 'onStart', { focalX: 100, focalY: 100 }))
  at(startMs + 1, () => call(member(PINCH), 'onUpdate', { scale: 2, focalX: 100, focalY: 100 }))
  at(endMs, () => call(member(PINCH), 'onEnd', {}, true))
}
const drag = (startMs: number, endMs: number): void => {
  at(startMs, () => call(member(PAN), 'onStart', {}))
  at(startMs + 1, () => call(member(PAN), 'onUpdate', { translationX: 8, translationY: 0 }))
  at(endMs, () => call(member(PAN), 'onEnd', {}, true))
}
const doubleTap = (atMs: number): void =>
  at(atMs, () => call(member(TAP), 'onEnd', { x: 100, y: 100 }))

let view: ReturnType<typeof render>
let widthPx = 200

function tree(): React.ReactElement {
  return React.createElement(
    ThemeProvider,
    null,
    React.createElement(
      ZoomableImage,
      {
        width: widthPx,
        height: 200,
        resetKey: 'a',
        children: React.createElement('span', { 'data-testid': 'picture' }),
      },
    ),
  )
}

/** jsdom has no layout: report a 200x200 box so the picture gets its size. */
class FixedBoxObserver {
  constructor(private readonly onResize: (entries: readonly { target: Element }[]) => void) {}
  observe(target: Element): void {
    this.onResize([{ target }])
  }
  unobserve(): void {}
  disconnect(): void {}
}

function mount(): void {
  widthPx = 200
  vi.stubGlobal('ResizeObserver', FixedBoxObserver)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200)
  view = render(tree())
  act(() => {
    vi.advanceTimersByTime(50)
  })
}

/** The scale the picture is drawn at. Shared values do not re-render, so a
 *  one-pixel width change makes the memoised component evaluate its style. */
function scaleNow(): number {
  widthPx += 1
  act(() => view.rerender(tree()))
  const el = view.getByTestId('picture').parentElement
  const m = /scale\(([\d.]+)\)/.exec(el?.getAttribute('style') ?? '')
  return m === null ? 1 : Number(m[1])
}

beforeEach(() => {
  vi.useFakeTimers()
  composed = null
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('gallery ZoomableImage double tap', () => {
  it('a real double tap (two single-finger touches) steps the ladder', () => {
    mount()
    down(5_000, 1)
    up(5_060)
    down(5_180, 1)
    up(5_240)
    doubleTap(5_240)
    expect(scaleNow()).toBe(2)
  })

  it('the two fingers of a pinch are not a double tap', () => {
    mount()
    down(1_000, 1)
    down(1_010, 2)
    pinch(1_020, 1_300)
    up(1_300)
    up(1_310)
    const afterPinch = scaleNow()
    expect(afterPinch).toBeGreaterThan(1)
    // The recogniser hands the pinch's two touch-downs to the ladder.
    doubleTap(1_320)
    expect(scaleNow()).toBe(afterPinch)
  })

  it('two short drags of the zoomed picture are not a double tap', () => {
    mount()
    down(1_000, 1)
    down(1_010, 2)
    pinch(1_020, 1_300)
    up(1_300)
    up(1_310)
    const zoomed = scaleNow()
    down(5_000, 1)
    drag(5_020, 5_120)
    up(5_120)
    down(5_270, 1)
    drag(5_290, 5_350)
    up(5_350)
    doubleTap(5_350)
    expect(scaleNow()).toBe(zoomed)
  })
})
