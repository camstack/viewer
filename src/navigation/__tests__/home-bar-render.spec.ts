/**
 * @vitest-environment jsdom
 *
 * HomeBar, mounted: the ☰ opens the app drawer, the bell is the element the
 * navigator wraps in its notifications trigger, the wide title names `/` as
 * Cameras, and the bar clears a side notch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { useAppStore } from '../../apps/app-store.js'
import { HomeBar } from '../HomeBar.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const wrapped: string[] = []
const wrapBell = (children: React.ReactElement): React.JSX.Element => {
  wrapped.push(String((children.props as { testID?: string }).testID))
  return React.createElement(React.Fragment, null, children)
}

beforeEach(() => {
  wrapped.length = 0
  useAppStore.getState().setDrawerOpen(false)
})
afterEach(cleanup)

describe('HomeBar', () => {
  it('opens the app drawer from the ☰', () => {
    const view = mountScreen(React.createElement(HomeBar, { variant: 'phone', pathname: '/cameras', wrapBell }))
    expect(useAppStore.getState().drawerOpen).toBe(false)
    fireEvent.click(view.getByTestId('drawer-menu-button'))
    expect(useAppStore.getState().drawerOpen).toBe(true)
  })

  it('hands the bell to the navigator wrapper, which routes it to notifications', () => {
    const view = mountScreen(React.createElement(HomeBar, { variant: 'phone', pathname: '/cameras', wrapBell }))
    expect(view.getByTestId('home-bar-bell')).toBeTruthy()
    expect(wrapped).toEqual(['home-bar-bell'])
  })

  it('names the wide bar after Cameras on the index route', () => {
    const view = mountScreen(React.createElement(HomeBar, { variant: 'wide', pathname: '/', wrapBell }))
    expect(view.getByTestId('home-bar').textContent).toContain('Cameras')
  })
})
