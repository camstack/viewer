/**
 * @vitest-environment jsdom
 *
 * The device-information pill on the GRID. 1.0.596 mounted it only inside
 * `GridWall` (Android); iOS and web draw the grid in `GridLiveEmbed` (one
 * WebView / iframe), which never mounted it — the setting did nothing there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { DEFAULTS, useSettingsStore } from '../../../store/settings-store.js'
import { GridLiveEmbed } from '../../../grid-embed/GridLiveEmbed.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GridWall } from '../GridWall.js'
import { computeGridLayout } from '../../../grid/auto-layout.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

function setPosition(deviceInfo: 'off' | 'top-right'): void {
  useSettingsStore.setState({ settings: { ...DEFAULTS, deviceInfo } })
}

const PROPS = {
  devices: [1, 2],
  quality: 'auto',
  layout: 'auto',
  showName: true,
  audioOnIds: [],
  pausedIds: [],
  highlight: { motionColor: '#fff', audioColor: '#fff', detectionColor: '#fff', thickness: 2 },
} as never

describe.each([
  ['GridLiveEmbed (iOS WebView)', () => React.createElement(GridLiveEmbed, PROPS)],
  [
    'GridWall (Android native wall)',
    () =>
      React.createElement(GridWall, {
        cameras: [],
        layout: computeGridLayout(1, 400, 300, 'auto'),
        showName: true,
        quality: 'auto',
      } as never),
  ],
])('%s', (_name, make) => {
  beforeEach(() => cleanup())
  afterEach(() => cleanup())

  it('renders the device-information pill when enabled', () => {
    setPosition('top-right')
    mountScreen(make())
    expect(screen.queryByTestId('device-info-overlay')).not.toBeNull()
    expect(screen.queryByTestId('device-info-clock')).not.toBeNull()
  })

  it('does not render it when the setting is off', () => {
    setPosition('off')
    mountScreen(make())
    expect(screen.queryByTestId('device-info-overlay')).toBeNull()
  })
})

describe('GridLiveEmbed.web (PWA iframe)', () => {
  // The iframe host needs a signed-in server URL to leave its error branch, which
  // the mount harness does not fake; pin the wiring on the source instead.
  it('mounts the same GridDeviceInfo element as the native embed', () => {
    const src = readFileSync(join(process.cwd(), 'src/grid-embed/GridLiveEmbed.web.tsx'), 'utf8')
    expect(src).toContain("import { GridDeviceInfo } from '../components/grid/GridDeviceInfo.js'")
    expect(src).toContain('<GridDeviceInfo />')
  })
})
