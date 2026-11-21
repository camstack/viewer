/**
 * @vitest-environment jsdom
 *
 * The overlay frame: where the picture is, and how big the read-outs are on it.
 *
 * jsdom has no layout, so the frame's box is faked the way react-native-web
 * measures it (`offsetWidth` / `offsetHeight`, delivered through a
 * `ResizeObserver`); everything downstream — the letterboxed rectangle, the
 * multiplier, an overlay's own font size — is the real code.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import {
  DEVICE_SETTINGS_DEFAULTS,
  useDeviceSettingsStore,
} from '../../../store/device-settings-store.js'
import { OverlayFrame, useOverlayScale } from '../overlay/OverlayFrame.js'
import { LiveViewersBadge } from '../LiveViewersBadge.js'
import { overlayScale, videoRectIn, type OverlaySize, type VideoFit } from '../overlay/overlay-size.js'
import { Text } from 'react-native'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const box = { width: 0, height: 0 }

beforeAll(() => {
  // react-native-web delivers onLayout through ONE shared ResizeObserver.
  class FakeResizeObserver {
    constructor(private readonly cb: (entries: { target: Element }[]) => void) {}
    observe(target: Element): void {
      this.cb([{ target }])
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: FakeResizeObserver })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => box.width,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => box.height,
  })
})

beforeEach(() => {
  useDeviceSettingsStore.setState({ settings: DEVICE_SETTINGS_DEFAULTS })
})

afterEach(() => cleanup())

function Probe(): React.ReactElement {
  const scale = useOverlayScale()
  return React.createElement(Text, { testID: 'probe' }, String(scale))
}

interface Mounted {
  readonly scale: number
  /** The coordinate space the children are laid out in — the CONTAINER. */
  readonly container: Record<'position' | 'left' | 'top' | 'right' | 'bottom', string>
}

async function mountFrame(
  width: number,
  height: number,
  fit: VideoFit,
  size: OverlaySize,
  aspect?: number,
): Promise<Mounted> {
  box.width = width
  box.height = height
  useDeviceSettingsStore.setState({
    settings: { ...DEVICE_SETTINGS_DEFAULTS, overlaySize: size },
  })
  mountScreen(
    React.createElement(OverlayFrame, {
      fit,
      ...(aspect === undefined ? {} : { aspect }),
      children: React.createElement(Probe),
    }),
  )
  // The measure is deferred one macrotask by react-native-web.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
  const probe = screen.getByTestId('probe')
  const style = getComputedStyle(probe.parentElement as HTMLElement)
  return {
    scale: Number(probe.textContent),
    container: { position: style.position, left: style.left, top: style.top, right: style.right, bottom: style.bottom },
  }
}

describe('OverlayFrame', () => {
  // Sizes moved one step down on 2026-10-16 (operator: overlays too large):
  // medium on a phone-portrait picture is what small used to be.
  it('portrait (cover): the picture IS the box, medium is ~0.64x', async () => {
    const m = await mountFrame(390, 219, 'cover', 'medium')
    expect(m.scale).toBeCloseTo(overlayScale(390, 'medium'), 5)
    expect(m.scale).toBeGreaterThan(0.6)
    expect(m.scale).toBeLessThan(0.7)
  })

  it('landscape fullscreen (contain): children lay out in the CONTAINER (bars included), the size follows the PICTURE', async () => {
    const m = await mountFrame(932, 430, 'contain', 'medium')
    const expected = videoRectIn({ width: 932, height: 430 }, 'contain')
    // Overlays anchor to the container's corners, not the letterboxed picture.
    expect(m.container).toEqual({ position: 'absolute', left: '0px', top: '0px', right: '0px', bottom: '0px' })
    // A bigger picture, bigger read-outs — measured on the picture, not the screen.
    expect(m.scale).toBeCloseTo(overlayScale(expected.width, 'medium'), 5)
    expect(m.scale).toBeGreaterThan(1.2)
  })

  it('follows the stream aspect: a 4:3 picture is pillarboxed harder than 16:9', async () => {
    const wide = await mountFrame(800, 450, 'contain', 'medium')
    cleanup()
    const fourThree = await mountFrame(800, 450, 'contain', 'medium', 4 / 3)
    expect(fourThree.container).toEqual(wide.container)
    expect(fourThree.scale).toBeLessThan(wide.scale)
  })

  it('small < medium < large on the same picture', async () => {
    const small = await mountFrame(600, 338, 'cover', 'small')
    cleanup()
    const medium = await mountFrame(600, 338, 'cover', 'medium')
    cleanup()
    const large = await mountFrame(600, 338, 'cover', 'large')
    expect(small.scale).toBeLessThan(medium.scale)
    expect(medium.scale).toBeLessThan(large.scale)
  })

  it('a small grid tile stays legible (floor) and a huge picture does not draw a banner (ceiling)', async () => {
    const tile = await mountFrame(160, 90, 'contain', 'small')
    cleanup()
    const huge = await mountFrame(3000, 1688, 'cover', 'large')
    expect(tile.scale).toBe(0.5)
    expect(huge.scale).toBe(2)
  })
})

describe('an overlay inside the frame is drawn at the frame\'s size', () => {
  async function countFontPx(size: OverlaySize, width: number, height: number): Promise<number> {
    box.width = width
    box.height = height
    useDeviceSettingsStore.setState({
      settings: { ...DEVICE_SETTINGS_DEFAULTS, overlaySize: size },
    })
    mountScreen(
      React.createElement(OverlayFrame, {
        fit: 'cover',
        children: React.createElement(LiveViewersBadge, {
          deviceId: 7,
          enabled: true,
        }),
      }),
      { hub: { 'streamBroker.getLiveViewerCounts': [{ deviceId: 7, viewers: 4 }] } },
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    const badge = await screen.findByTestId('live-viewers-badge')
    const count = badge.querySelector('[dir="auto"]')
    return parseFloat((count as HTMLElement).style.fontSize)
  }

  it('the count text is the base size times the multiplier of ITS picture', async () => {
    const mediumPhone = await countFontPx('medium', 390, 219)
    cleanup()
    const largePhone = await countFontPx('large', 390, 219)
    cleanup()
    const mediumWide = await countFontPx('medium', 780, 439)
    expect(mediumPhone).toBeCloseTo(12 * overlayScale(390, 'medium'), 1)
    expect(largePhone).toBeGreaterThan(mediumPhone)
    expect(mediumWide).toBeGreaterThan(mediumPhone)
  })
})
