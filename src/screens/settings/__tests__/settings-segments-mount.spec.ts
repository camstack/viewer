/**
 * @vitest-environment jsdom
 *
 * The Settings tab mounted: three segments behind the Library tab's selector,
 * one shown at a time, the choice written to the device-local store. Account
 * is not one of them: it is the shell's `/account` (D1102).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { DEVICE_SETTINGS_DEFAULTS, useDeviceSettingsStore } from '../../../store/device-settings-store.js'
import { SettingsScreen } from '../../SettingsScreen.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const HUB = { 'auth.me': { id: 'u1', username: 'operator', isAdmin: true } }

beforeEach(() => {
  setTestPlatform('web')
  useDeviceSettingsStore.setState({ settings: DEVICE_SETTINGS_DEFAULTS, hydrated: true })
})
afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

const segment = (key: string): HTMLElement => screen.getByTestId(`settings-segment-${key}`)
const shown = (el: HTMLElement): boolean => el.style.display !== 'none'

describe('Settings segments', () => {
  it('opens on the stored segment and mounts nothing else', () => {
    useDeviceSettingsStore.setState({ settings: { ...DEVICE_SETTINGS_DEFAULTS, settingsSegment: 'app' } })
    mountScreen(React.createElement(SettingsScreen), { hub: HUB })
    expect(shown(segment('app'))).toBe(true)
    expect(screen.queryByTestId('settings-segment-viewing')).toBeNull()
    expect(screen.queryByTestId('settings-segment-advanced')).toBeNull()
  })

  it('switching remembers the choice and keeps the left segment mounted, hidden', () => {
    mountScreen(React.createElement(SettingsScreen), { hub: HUB })
    expect(shown(segment('viewing'))).toBe(true)
    expect(screen.queryByTestId('settings-segment-account')).toBeNull()
    act(() => {
      fireEvent.click(screen.getByText('Advanced'))
    })
    expect(useDeviceSettingsStore.getState().settings.settingsSegment).toBe('advanced')
    expect(shown(segment('advanced'))).toBe(true)
    // Still there — its scroll position survives — but not shown.
    expect(shown(segment('viewing'))).toBe(false)
    expect(screen.getByText('Diagnostics')).toBeTruthy()
  })
})
