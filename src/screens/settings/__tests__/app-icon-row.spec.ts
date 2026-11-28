/**
 * @vitest-environment jsdom
 *
 * Settings → App → "App icon": the row exists only where the device can switch
 * its launcher icon, shows the active one, and a pick applies at once through
 * the native call — nothing to save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'

const native = vi.hoisted(() => ({
  supported: true,
  active: null as string | null,
  setCalls: [] as (string | null)[],
}))

vi.mock('expo-alternate-app-icons', () => ({
  get supportsAlternateIcons() {
    return native.supported
  },
  getAppIconName: () => native.active,
  setAlternateAppIcon: async (name: string | null) => {
    native.setCalls.push(name)
    native.active = name
    return name
  },
}))

import { AppIconRow } from '../AppIconRow.js'

beforeEach(() => {
  native.supported = true
  native.active = null
  native.setCalls = []
})
afterEach(() => cleanup())

describe('the App icon row', () => {
  it('is absent when the device cannot switch its icon', () => {
    native.supported = false
    mountScreen(React.createElement(AppIconRow))
    expect(screen.queryByText('App icon')).toBeNull()
  })

  it('shows the default icon name and lists default + ten icons in the sheet', () => {
    mountScreen(React.createElement(AppIconRow))
    expect(screen.getByText('App icon')).toBeTruthy()
    expect(screen.getByText('Default')).toBeTruthy()
    act(() => {
      fireEvent.click(screen.getByText('App icon'))
    })
    expect(screen.getByTestId('app-icon-sheet')).toBeTruthy()
    expect(screen.getByTestId('app-icon-option-default')).toBeTruthy()
    expect(screen.getAllByTestId(/^app-icon-option-/)).toHaveLength(11)
  })

  it('applies a pick immediately and shows it as the current icon', async () => {
    mountScreen(React.createElement(AppIconRow))
    act(() => {
      fireEvent.click(screen.getByText('App icon'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('app-icon-option-Owl'))
    })
    expect(native.setCalls).toEqual(['Owl'])
    expect(screen.queryByTestId('app-icon-sheet')).toBeNull()
    expect(screen.getByText('Owl')).toBeTruthy()
  })

  it('restores the default with null', async () => {
    native.active = 'Mint'
    mountScreen(React.createElement(AppIconRow))
    expect(screen.getByText('Mint')).toBeTruthy()
    act(() => {
      fireEvent.click(screen.getByText('App icon'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('app-icon-option-default'))
    })
    expect(native.setCalls).toEqual([null])
  })
})
