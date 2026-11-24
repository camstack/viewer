/**
 * @vitest-environment jsdom
 *
 * ScreenHeader on an inner route carries the ☰ that opens the app drawer; on a
 * picture route (no bar) or without a back button it does not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { useAppStore } from '../../apps/app-store.js'
import { ScreenHeader } from '../ScreenHeader.js'

beforeEach(() => useAppStore.getState().setDrawerOpen(false))
afterEach(cleanup)

describe('ScreenHeader ☰', () => {
  it('opens the drawer from an inner route', () => {
    const view = mountScreen(React.createElement(ScreenHeader, { title: 'Manage cameras', onBack: vi.fn() }), { pathname: '/settings/cameras' })
    fireEvent.click(view.getByTestId('header-menu-button'))
    expect(useAppStore.getState().drawerOpen).toBe(true)
  })

  it('is absent on a route that has no bar', () => {
    const view = mountScreen(React.createElement(ScreenHeader, { title: 'Front door', onBack: vi.fn() }), { pathname: '/camera/4' })
    expect(view.queryByTestId('header-menu-button')).toBeNull()
  })
})
