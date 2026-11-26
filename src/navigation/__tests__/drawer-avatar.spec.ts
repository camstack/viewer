/**
 * @vitest-environment jsdom
 *
 * planning#716 P1: the bar's ☰ is replaced by the user's avatar (still opening the
 * drawer, still at the left), and the drawer's bottom shows the user, the server
 * and the server switch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { resetRouterStub, routerCalls } from '../../testing/native-stubs/expo-router.js'
import { useAppStore } from '../../apps/app-store.js'
import { AppDrawer } from '../../apps/AppDrawer.js'
import { DrawerMenuButton } from '../DrawerMenuButton.js'
import { HomeBar } from '../HomeBar.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const wrapBell = (children: React.ReactElement): React.JSX.Element => React.createElement(React.Fragment, null, children)

beforeEach(() => useAppStore.getState().setDrawerOpen(false))
afterEach(cleanup)

describe('the drawer button is the user avatar', () => {
  it('draws the initial, not a menu glyph, and opens the drawer', () => {
    const view = mountScreen(React.createElement(DrawerMenuButton, { orientation: 'column' }))
    const button = view.getByTestId('drawer-menu-button')
    expect(button.textContent).toMatch(/^[A-Z?]$/)
    fireEvent.click(button)
    expect(useAppStore.getState().drawerOpen).toBe(true)
  })

  it('sits first in the phone bar, before the title', () => {
    const view = mountScreen(React.createElement(HomeBar, { variant: 'phone', pathname: '/cameras', wrapBell }))
    const bar = view.getByTestId('home-bar')
    expect(bar.firstElementChild?.getAttribute('data-testid')).toBe('drawer-menu-button')
  })
})

describe('the drawer bottom', () => {
  it('shows the signed-in user and the current server', () => {
    useAppStore.getState().setDrawerOpen(true)
    const view = mountScreen(React.createElement(AppDrawer))
    const block = view.getByTestId('drawer-account')
    expect(block.textContent).toBeTruthy()
    expect(view.getByTestId('drawer-account-name')).toBeTruthy()
  })

  it('has an Account entry that opens /account (planning#716 P2) and closes the drawer', () => {
    resetRouterStub()
    useAppStore.getState().setDrawerOpen(true)
    const view = mountScreen(React.createElement(AppDrawer))
    fireEvent.click(view.getByTestId('drawer-account-link'))
    expect(routerCalls().some((c) => c.kind === 'push' && c.target === '/account')).toBe(true)
    expect(useAppStore.getState().drawerOpen).toBe(false)
  })

  it('keeps the switch out when there is a single server (a control with one option is not rendered)', () => {
    useAppStore.getState().setDrawerOpen(true)
    const view = mountScreen(React.createElement(AppDrawer))
    expect(view.queryByTestId('drawer-switch-server')).toBeNull()
  })
})

describe('the bottom bar and the side rail carry no avatar (the one avatar is the shell bar\'s)', () => {
  it('neither renders a user-menu-button or a drawer button', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    for (const rel of ['src/navigation/BottomNavBar.tsx', 'src/navigation/SideNavRail.tsx', 'src/navigation/NavAccountCluster.tsx']) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8')
      expect(src, rel).not.toMatch(/UserMenuButton|user-menu-button|DrawerMenuButton|UserAvatar/)
    }
  })

  it('the wide home bar still reaches the drawer, at its left', () => {
    const view = mountScreen(React.createElement(HomeBar, { variant: 'wide', pathname: '/cameras', wrapBell }))
    const bar = view.getByTestId('home-bar')
    expect(bar.firstElementChild?.getAttribute('data-testid')).toBe('drawer-menu-button')
    fireEvent.click(view.getByTestId('drawer-menu-button'))
    expect(useAppStore.getState().drawerOpen).toBe(true)
  })
})
