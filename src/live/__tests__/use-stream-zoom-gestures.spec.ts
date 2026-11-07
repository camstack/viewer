/**
 * @vitest-environment jsdom
 *
 * Pinch-zoom "snaps back / gets stuck": the hook-level contracts.
 * Driven by hand through the gesture stub (see `use-stream-zoom.spec.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { setLogVerbose, useLogStore } from '../../lib/logger.js'
import { useStreamZoom, type StreamZoom } from '../use-stream-zoom.js'
import { streamPanExtent } from '../stream-zoom-clamp.js'
import type { StubGesture } from '../../testing/native-stubs/gesture-handler.js'

const fixedBox = (): number => 242

function mount(trace = false) {
  return renderHook(() =>
    useStreamZoom({
      contentAspect: 16 / 9,
      fit: 'cover',
      viewport: { width: 400, heightFor: fixedBox },
      trace,
    }),
  )
}

function child(zoom: StreamZoom, index: number): StubGesture {
  const composed = zoom.composeWith() as unknown as StubGesture
  const g = composed.__children[index]
  if (g === undefined) throw new Error(`no gesture at ${index}`)
  return g
}
const call = (g: StubGesture, name: string, ...args: unknown[]): void => {
  const h = g.__handlers[name] as ((...a: unknown[]) => unknown) | undefined
  if (h === undefined) throw new Error(`no ${name}`)
  h(...args)
}
const pinchOf = (z: StreamZoom) => child(z, 0)
const panOf = (z: StreamZoom) => child(z, 1)
const trackerOf = (z: StreamZoom) => child(z, 2)

describe('pinch seeds from the LIVE transform', () => {
  it('a pinch started while a reset is still animating continues from the live scale', () => {
    const { result } = mount()
    // Mid-animation: the reset already committed 1, the picture is still at 2.3.
    act(() => {
      result.current.scale.value = 2.3
      result.current.committedScale.value = 1
    })
    act(() => {
      call(pinchOf(result.current), 'onStart', {
        focalX: 200,
        focalY: 100,
        numberOfPointers: 2,
      })
      call(pinchOf(result.current), 'onUpdate', {
        scale: 1,
        focalX: 200,
        focalY: 100,
        numberOfPointers: 2,
      })
    })
    // scale factor 1 => no movement: the frame must not jump to the committed 1x.
    expect(result.current.scale.value).toBeCloseTo(2.3, 6)
    expect(result.current.committedScale.value).toBeCloseTo(2.3, 6)
  })

  it('a cancelled pinch commits the live state instead of leaving the old one behind', () => {
    const { result } = mount()
    act(() => {
      call(pinchOf(result.current), 'onStart', {
        focalX: 200,
        focalY: 100,
        numberOfPointers: 2,
      })
      call(pinchOf(result.current), 'onUpdate', {
        scale: 2,
        focalX: 200,
        focalY: 100,
        numberOfPointers: 2,
      })
      call(pinchOf(result.current), 'onFinalize', {}, false)
    })
    expect(result.current.committedScale.value).toBeCloseTo(2, 6)
  })

  it('a finalize of a pinch that never started changes nothing', () => {
    const { result } = mount()
    act(() => {
      result.current.scale.value = 2
      result.current.committedScale.value = 3
      call(pinchOf(result.current), 'onFinalize', {}, false)
    })
    expect(result.current.committedScale.value).toBe(3)
  })

  it('a pan started during the reset animation also seeds from the live scale', () => {
    const { result } = mount()
    act(() => {
      result.current.scale.value = 2.3
      result.current.committedScale.value = 1
      call(panOf(result.current), 'onStart', {})
    })
    expect(result.current.committedScale.value).toBeCloseTo(2.3, 6)
  })
})

describe('the touch tracker', () => {
  it('records two fingers and a pinch for the sequence', () => {
    const { result } = mount()
    act(() => {
      call(trackerOf(result.current), 'onTouchesDown', { numberOfTouches: 1 })
      call(trackerOf(result.current), 'onTouchesDown', { numberOfTouches: 2 })
      call(pinchOf(result.current), 'onStart', {
        focalX: 1,
        focalY: 1,
        numberOfPointers: 2,
      })
    })
    expect(result.current.touchSequence.value).toMatchObject({
      maxTouches: 2,
      pinchSeen: true,
    })
  })
})

describe('double tap refusal', () => {
  const setup = () => {
    const hook = mount()
    act(() => {
      call(trackerOf(hook.result.current), 'onTouchesDown', {
        numberOfTouches: 1,
      })
    })
    return hook
  }

  it('zooms in on a clean one-finger double tap', () => {
    const { result } = setup()
    act(() => result.current.doubleTapZoomAt(100, 100))
    expect(result.current.scale.value).toBeGreaterThan(1)
  })

  it('does NOT reset a zoom when a second finger was down during the touch', () => {
    const { result } = setup()
    act(() => {
      result.current.scale.value = 2.5
      result.current.committedScale.value = 2.5
      call(trackerOf(result.current), 'onTouchesDown', { numberOfTouches: 2 })
      result.current.doubleTapZoomAt(100, 100)
    })
    expect(result.current.scale.value).toBe(2.5)
  })

  it('does NOT reset a zoom when a pinch happened during the touch', () => {
    const { result } = setup()
    act(() => {
      result.current.scale.value = 2.5
      call(pinchOf(result.current), 'onStart', {
        focalX: 1,
        focalY: 1,
        numberOfPointers: 2,
      })
      call(pinchOf(result.current), 'onEnd', {}, true)
    })
    // clear the 350 ms post-pinch clock so only the sequence gate decides
    act(() => {
      result.current.scale.value = 2.5
    })
    // (pinch end stamped lastPinchEnd=now; refusal reason is either gate — both refuse)
    act(() => result.current.doubleTapZoomAt(100, 100))
    expect(result.current.scale.value).toBe(2.5)
  })
})

describe('debug trace is off by default', () => {
  afterEach(() => {
    setLogVerbose(false)
    useLogStore.getState().clear()
  })
  const zoomLines = () => useLogStore.getState().entries.filter((e) => e.scope === 'live:zoom')

  it('writes nothing with trace off', () => {
    setLogVerbose(true)
    const { result } = mount(false)
    act(() => {
      call(pinchOf(result.current), 'onStart', {
        focalX: 1,
        focalY: 1,
        numberOfPointers: 2,
      })
      call(pinchOf(result.current), 'onUpdate', {
        scale: 1.5,
        focalX: 1,
        focalY: 1,
        numberOfPointers: 2,
      })
      result.current.resetZoom('test')
      result.current.snapZoom('test')
    })
    expect(
      zoomLines().filter(
        (e) =>
          e.msg.startsWith('zoom reset') || e.msg.startsWith('zoom snap') || e.msg.startsWith('zoom pinch'),
      ),
    ).toEqual([])
  })

  it('names the reason of a reset and of a snap with trace on', () => {
    setLogVerbose(true)
    const { result } = mount(true)
    act(() => {
      result.current.resetZoom('fill flip')
      result.current.snapZoom('viewport resize')
    })
    const text = zoomLines()
      .map((e) => `${e.msg} ${JSON.stringify(e.data ?? {})}`)
      .join('\n')
    expect(text).toContain('fill flip')
    expect(text).toContain('viewport resize')
  })
})

describe('reclampZoom', () => {
  it('pulls a pan that sits past the new box limit back inside, keeping the zoom', () => {
    let boxH = 250
    const { result, rerender } = renderHook(() =>
      useStreamZoom({
        contentAspect: 16 / 9,
        fit: 'contain',
        viewport: { width: 400, heightFor: () => boxH },
      }),
    )
    act(() => {
      result.current.scale.value = 3
      call(panOf(result.current), 'onStart', {})
      call(panOf(result.current), 'onUpdate', { translationX: 0, translationY: 5000 })
    })
    rerender()
    const before = result.current.videoStyle as unknown as { transform: Record<string, number>[] }
    const tyBefore = before.transform.find((t) => 'translateY' in t)?.translateY ?? Number.NaN
    expect(tyBefore).toBeGreaterThan(0)
    boxH = 600
    act(() => {
      result.current.reclampZoom()
    })
    rerender()
    const limit = streamPanExtent(400, 600, 16 / 9, 3, 'contain').y
    const after = result.current.videoStyle as unknown as { transform: Record<string, number>[] }
    const tyAfter = after.transform.find((t) => 'translateY' in t)?.translateY ?? Number.NaN
    expect(Math.abs(tyAfter)).toBeLessThanOrEqual(limit + 1e-6)
    expect(Math.abs(tyAfter)).toBeLessThan(Math.abs(tyBefore))
    expect(result.current.scale.value).toBe(3)
  })
})
