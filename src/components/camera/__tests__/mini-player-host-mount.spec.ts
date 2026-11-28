/**
 * @vitest-environment jsdom
 *
 * The mini-player, mounted: where it rests, what it leaves tappable, and that
 * its position follows the route's bars.
 *
 * Touch pass-through is proved from the COMPUTED style of the real tree, not
 * from a prop name: react-native-web turns `pointerEvents="box-none"` into a
 * rule (`pointer-events: none` on the box, `auto` on its children), so the
 * host root must compute to `none` — a click that lands outside the floating
 * box then belongs to whatever is underneath — while the box itself computes to
 * `auto`. jsdom has no layout, so it cannot hit-test; the real hit test (a
 * browser `elementFromPoint` over the web build) is recorded in the session
 * notes of this change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React from 'react'
import { Pressable } from 'react-native'
import { mountScreen } from '../../../testing/mount.js'
import { setTestViewport } from '../../../testing/viewport-control.js'
import { setTestPathname } from '../../../testing/native-stubs/expo-router.js'
import { TEST_INSETS } from '../../../testing/native-stubs/safe-area-context.js'
import { OnDemandPlayerHost } from '../OnDemandPlayerHost.js'
import {
  ONDEMAND_BOX_DEFAULTS,
  useOnDemandPlayerStore,
} from '../../../store/ondemand-player-store.js'
import {
  cornerPosition,
  onDemandArea,
  resolveOnDemandBox,
  type OnDemandCorner,
} from '../../../live/ondemand-geometry.js'
import { onDemandInsets } from '../../../live/ondemand-insets.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const PHONE = { width: 390, height: 844 }
const CAMERAS = [{ id: 1, name: 'Front door', isCamera: true, online: true, disabled: false }]
const HUB = { 'deviceManager.listAll': CAMERAS }

function mountOver(pathname: string) {
  return mountScreen(
    React.createElement(
      React.Fragment,
      null,
      // The app underneath: a pressable that covers the whole window.
      React.createElement(Pressable, { testID: 'under', style: { flex: 1 } }),
      React.createElement(OnDemandPlayerHost),
    ),
    { hub: HUB, pathname },
  )
}

/** Where the panel actually is, read off its inline style. */
function panelAt(panel: HTMLElement): { x: number; y: number; width: number } {
  return {
    x: Number.parseFloat(panel.style.left),
    y: Number.parseFloat(panel.style.top),
    width: Number.parseFloat(panel.style.width),
  }
}

/** What the harness's route draws: the stub's safe area plus the route's bars. */
function expectedAt(pathname: string, corner: OnDemandCorner) {
  const insets = onDemandInsets({
    pathname,
    safe: { ...TEST_INSETS, left: 0, right: 0 },
    showSidebar: false,
    compactSidebar: false,
  })
  const box = resolveOnDemandBox('medium', onDemandArea(PHONE, insets))
  return { insets, box, at: cornerPosition(corner, box, PHONE, insets) }
}

beforeEach(() => {
  setTestViewport(PHONE)
  useOnDemandPlayerStore.setState({
    request: { deviceId: 1, atMs: 'live' },
    prefs: ONDEMAND_BOX_DEFAULTS,
  })
})

afterEach(() => {
  cleanup()
  useOnDemandPlayerStore.setState({ request: null, prefs: ONDEMAND_BOX_DEFAULTS })
})

describe('the app underneath stays tappable', () => {
  it('the host root passes touches through; only the floating box takes them', async () => {
    const dom = mountOver('/cameras')
    const panel = await dom.findByTestId('ondemand-player')
    const root = panel.parentElement
    expect(root).not.toBeNull()
    expect(getComputedStyle(root as HTMLElement).pointerEvents).toBe('none')
    expect(getComputedStyle(panel).pointerEvents).toBe('auto')
    // The app underneath is not inside the host and is not shadowed by it.
    const under = dom.getByTestId('under')
    expect(root?.contains(under)).toBe(false)
    expect(getComputedStyle(under).pointerEvents).not.toBe('none')
  })

  it('draws nothing else at the window size: the box is the root\'s only child', async () => {
    const dom = mountOver('/cameras')
    const panel = await dom.findByTestId('ondemand-player')
    expect(panel.parentElement?.children.length).toBe(1)
  })

  it('closing leaves nothing over the app', async () => {
    const dom = mountOver('/cameras')
    await dom.findByTestId('ondemand-player')
    await act(async () => useOnDemandPlayerStore.getState().close())
    expect(dom.queryByTestId('ondemand-player')).toBeNull()
  })
})

describe('where the box rests', () => {
  it('opens in the bottom-right corner, clear of the home bar and the tab capsule', async () => {
    const dom = mountOver('/cameras')
    const panel = await dom.findByTestId('ondemand-player')
    const want = expectedAt('/cameras', 'bottomRight')
    expect(panelAt(panel)).toEqual({ x: want.at.x, y: want.at.y, width: want.box.width })
    // Clear of the capsule below it: its bottom edge is above the tab bar.
    expect(want.at.y + want.box.height).toBeLessThanOrEqual(PHONE.height - want.insets.bottom)
    expect(want.insets.bottom).toBeGreaterThan(TEST_INSETS.bottom)
  })

  it.each(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const)(
    'rests on %s when the operator dropped it there',
    async (corner) => {
      useOnDemandPlayerStore.setState({ prefs: { size: null, corner } })
      const dom = mountOver('/cameras')
      const panel = await dom.findByTestId('ondemand-player')
      const want = expectedAt('/cameras', corner)
      expect(panelAt(panel)).toEqual({ x: want.at.x, y: want.at.y, width: want.box.width })
    },
  )

  it('moves when a release commits a corner', async () => {
    const dom = mountOver('/cameras')
    const panel = await dom.findByTestId('ondemand-player')
    await act(async () => useOnDemandPlayerStore.getState().setCorner('topLeft'))
    const want = expectedAt('/cameras', 'topLeft')
    expect(panelAt(panel).x).toBe(want.at.x)
    expect(panelAt(panel).y).toBe(want.at.y)
  })

  /** A picture route draws no tab capsule, so the same corner sits lower. */
  it('re-resolves against the route: on a camera screen the bottom is only the safe area', async () => {
    useOnDemandPlayerStore.setState({ prefs: { size: null, corner: 'bottomRight' } })
    const dom = mountOver('/cameras')
    const panel = await dom.findByTestId('ondemand-player')
    const onTabs = panelAt(panel)
    await act(async () => setTestPathname('/camera/1'))
    const onCamera = panelAt(dom.getByTestId('ondemand-player'))
    expect(onCamera.y).toBeGreaterThan(onTabs.y)
  })
})
