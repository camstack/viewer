/**
 * @vitest-environment jsdom
 *
 * The fullscreen PTZ pad (operator, 2026-10-23: "PTZ controls in full screen,
 * as was done for the navigation, with a button to activate it").
 *
 * - The disc exists only when the screen hands a `ptzToggle` — i.e. only for a
 *   camera with PTZ the session may steer, in fill. Never a disabled disc.
 * - The disc toggles the pad; the pad hides with the chrome.
 * - The pad IS `PtzControls`: a press reaches the same `ptz.*` cap call the
 *   timeline's panel makes, and reports itself so the auto-hide restarts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import '../../../../app/i18n.js'
import { ThemeProvider } from '../../../../theme/theme-provider.js'
import { mountScreen } from '../../../../testing/mount.js'
import { hubCalls } from '../../../../testing/hub-stub.js'
import { SPACING } from '../../../../theme/tokens.js'
import { PTZ_OVERLAY_MAX_WIDTH, ptzOverlayLayout } from '../ptz-overlay-layout.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

const { StreamOverlayControls } = await import('../../StreamOverlayControls.js')
const { PtzOverlay, PTZ_OVERLAY_TEST_ID } = await import('../PtzOverlay.js')

afterEach(() => cleanup())

const noop = (): void => {}

function mountDiscs(ptzToggle?: { open: boolean; onToggle: () => void }) {
  return render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(StreamOverlayControls, {
        visible: true,
        onRequestHide: noop,
        paused: false,
        onTogglePause: noop,
        showPlayPause: false,
        muted: true,
        onToggleMute: noop,
        hasTwoWayAudio: false,
        talking: false,
        onToggleTalk: noop,
        onStartSystemPip: noop,
        fullscreen: true,
        onToggleFullscreen: noop,
        timelineToggle: { dock: 'off' as const, onSet: noop },
        ...(ptzToggle ? { ptzToggle } : {}),
      }),
    ),
  )
}

describe('the fullscreen PTZ disc', () => {
  it('is absent for a camera without PTZ (no toggle handed in)', () => {
    mountDiscs()
    expect(screen.queryByLabelText('Show PTZ controls')).toBeNull()
    expect(screen.queryByLabelText('Hide PTZ controls')).toBeNull()
  })

  it('is present for a PTZ camera and toggles the pad', () => {
    const onToggle = vi.fn()
    mountDiscs({ open: false, onToggle })
    fireEvent.click(screen.getByLabelText('Show PTZ controls'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('names the other action once the pad is open', () => {
    mountDiscs({ open: true, onToggle: noop })
    expect(screen.getByLabelText('Hide PTZ controls')).toBeTruthy()
  })
})

const PTZ_HUB = {
  'auth.me': { isAdmin: true, scope: null },
  'ptz.getOptions': { hasPan: true, hasTilt: true, hasZoom: true, supportsPresets: true, hasAutofocus: false },
  'ptz.getHomePreset': { source: 'preset', presetId: '1' },
  'ptz.getPresets': [{ id: 'p1', name: 'Gate' }],
  'ptz.move': null,
  'ptz.goToPreset': null,
}

function mountPad(visible: boolean, onInteract: () => void) {
  return mountScreen(
    React.createElement(PtzOverlay, {
      deviceId: 42,
      visible,
      edgePad: { left: 0, right: 0, bottom: 0 },
      onInteract,
    }),
    { hub: PTZ_HUB },
  )
}

describe('the fullscreen PTZ pad', () => {
  it('renders nothing while the chrome is hidden', () => {
    mountPad(false, noop)
    expect(screen.queryByTestId(PTZ_OVERLAY_TEST_ID)).toBeNull()
  })

  it('calls the same ptz cap actions as the panel, and reports every press', async () => {
    const onInteract = vi.fn()
    mountPad(true, onInteract)
    const panLeft = await screen.findByLabelText('Pan left')
    await act(async () => {
      fireEvent.click(panLeft)
    })
    expect(onInteract).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(hubCalls().filter((c) => c.path === 'ptz.move')).toEqual([
        { path: 'ptz.move', kind: 'mutate', input: { deviceId: 42, pan: -0.3 } },
      ]),
    )

    const preset = await screen.findByLabelText('Gate')
    await act(async () => {
      fireEvent.click(preset)
    })
    expect(onInteract).toHaveBeenCalledTimes(2)
    await waitFor(() =>
      expect(hubCalls().filter((c) => c.path === 'ptz.goToPreset')).toEqual([
        { path: 'ptz.goToPreset', kind: 'mutate', input: { deviceId: 42, presetId: 'p1' } },
      ]),
    )
  })
})

describe('where the pad sits', () => {
  const edgePad = { left: 47, right: 47, bottom: 21 }

  it('landscape: left edge, above the disc row, capped so the centre stays clear', () => {
    const layout = ptzOverlayLayout({ windowWidth: 844, windowHeight: 390, edgePad, topInset: 0, discSize: 40 })
    expect(layout.left).toBe(47 + SPACING.md)
    expect(layout.bottom).toBe(21 + SPACING.md + 40 + SPACING.lg)
    expect(layout.maxWidth).toBe(PTZ_OVERLAY_MAX_WIDTH)
    expect(layout.left + layout.maxWidth).toBeLessThan(844 / 2)
    expect(layout.maxHeight).toBe(390 - layout.bottom - SPACING.md)
  })

  it('portrait: narrower than the window, below the status bar', () => {
    const layout = ptzOverlayLayout({
      windowWidth: 390, windowHeight: 844, edgePad: { left: 0, right: 0, bottom: 34 }, topInset: 59, discSize: 40,
    })
    expect(layout.maxWidth).toBe(Math.min(PTZ_OVERLAY_MAX_WIDTH, 390 - SPACING.md * 2))
    expect(layout.maxHeight).toBe(844 - layout.bottom - 59 - SPACING.md)
  })
})

describe('the camera screen mounts it', () => {
  const SCREEN = readFileSync(join(process.cwd(), 'src/screens/CameraDetailScreen.tsx'), 'utf8')

  it('only in fill, only for a PTZ camera the session may steer, never over a robot drive', () => {
    expect(SCREEN).toContain('const hasPtz = canActuate && features.includes(FEATURE.ptz)')
    expect(SCREEN).toContain('const fullscreenPtz = fill && hasPtz && !hasNavigation')
    expect(SCREEN).toContain('ptzToggle={fullscreenPtz ? { open: ptzOverlayOpen, onToggle: onTogglePtzOverlay } : undefined}')
    expect(SCREEN).toMatch(/\{fullscreenPtz && ptzOverlayOpen \? \(\s*<PtzOverlay/)
  })

  it('shares the discs` visibility, and a press restarts their auto-hide', () => {
    const mount = SCREEN.slice(SCREEN.indexOf('<PtzOverlay'))
    const block = mount.slice(0, mount.indexOf('/>'))
    expect(block).toContain('visible={controlsVisible}')
    expect(block).toContain('onInteract={onChromeActivity}')
    expect(SCREEN).toContain('activity={chromeActivity}')
    const group = readFileSync(join(process.cwd(), 'src/components/camera/OverlayDiscGroup.tsx'), 'utf8')
    expect(group).toContain('[visible, holdOpen, onRequestHide, activity]')
  })

  it('closes the pad when the camera changes', () => {
    expect(SCREEN).toContain('setPtzOverlayOpen(false)')
  })
})
