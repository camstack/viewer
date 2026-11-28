/**
 * @vitest-environment jsdom
 *
 * planning#716 P1: with two saved servers the drawer's bottom block offers the
 * switch; the list runs the existing `switchServer` flow and the drawer closes
 * with the tap, whatever the outcome. "Open at launch" lives in the same block.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { setTestPlatform } from '../../testing/platform-control.js'
import { routerCalls } from '../../testing/native-stubs/expo-router.js'
import { useAppStore } from '../app-store.js'
import { AppDrawer } from '../AppDrawer.js'
import { ServerSwitchLoader } from '../ServerSwitchLoader.js'
import { HomeBar } from '../../navigation/HomeBar.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const APP_X = {
  addonId: 'a',
  app: {
    id: 'x',
    label: { key: 'apps.x', fallback: 'Ex' },
    icon: 'monitor',
    entry: { kind: 'web', path: '/', auth: 'handoff' },
    reach: { kind: 'hub' },
    adminOnly: false,
    nav: [],
    takesSharedSearch: false,
    settings: null,
  },
}

type Outcome = { status: 'switched' } | { status: 'needs-login' } | { status: 'unknown-server' }
const switchServer = vi.fn((_id: string): Promise<Outcome> => Promise.resolve({ status: 'switched' }))
const removeServer = vi.fn(() => Promise.resolve())
const signOut = vi.fn(() => Promise.resolve({ ok: true }))
const SAVED = [
  { id: 'a', label: 'Home', serverUrl: 'http://a.test', lastUsedAt: 2 },
  { id: 'b', label: 'Office', serverUrl: 'http://b.test', lastUsedAt: 1 },
]

vi.mock('../../app/ServerProvider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/ServerProvider.js')>()
  return {
    ...actual,
    useServer: () => ({ ...actual.useServer(), servers: SAVED, server: SAVED[0], switchServer, removeServer, signOut }),
  }
})

beforeEach(() => {
  switchServer.mockReset()
  signOut.mockClear()
  removeServer.mockClear()
  switchServer.mockResolvedValue({ status: 'switched' })
  useAppStore.getState().setDrawerOpen(true)
})
afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

const openMenu = (view: ReturnType<typeof mountScreen>): void => {
  fireEvent.click(view.getByTestId('drawer-user-block'))
}
const openList = (view: ReturnType<typeof mountScreen>): void => {
  openMenu(view)
  fireEvent.click(view.getByTestId('drawer-switch-server'))
}

describe('the drawer bottom with several servers', () => {
  it('shows the current server and the switch; a tap on another server switches and closes the drawer', async () => {
    const view = mountScreen(React.createElement(AppDrawer))
    expect(view.getByTestId('drawer-account-server').textContent).toBe('Home')
    openList(view)
    expect(view.getByTestId('server-switch-sheet')).toBeTruthy()
    fireEvent.click(view.getByTestId('server-switch-b'))
    await waitFor(() => expect(switchServer).toHaveBeenCalledWith('b'))
    expect(useAppStore.getState().drawerOpen).toBe(false)
  })

  it('needs-login: closes the drawer and sends the operator to add-server with the url', async () => {
    switchServer.mockResolvedValue({ status: 'needs-login' })
    const view = mountScreen(React.createElement(AppDrawer))
    openList(view)
    fireEvent.click(view.getByTestId('server-switch-b'))
    await waitFor(() =>
      expect(routerCalls()).toContainEqual({ kind: 'push', target: { pathname: '/add-server', params: { url: 'http://b.test' } } }),
    )
    expect(useAppStore.getState().drawerOpen).toBe(false)
  })

  it('a tap on the current server closes the drawer and switches nothing', () => {
    const view = mountScreen(React.createElement(AppDrawer))
    openList(view)
    fireEvent.click(view.getByTestId('server-switch-a'))
    expect(switchServer).not.toHaveBeenCalled()
    expect(useAppStore.getState().drawerOpen).toBe(false)
  })
})

describe('the server switch loader', () => {
  const mountBoth = () => mountScreen(React.createElement(React.Fragment, null, React.createElement(AppDrawer), React.createElement(ServerSwitchLoader)))

  it('covers the page with the target name while the switch runs, and clears when it settles', async () => {
    let settle: (o: Outcome) => void = () => undefined
    switchServer.mockReturnValue(new Promise<Outcome>((resolve) => (settle = resolve)))
    const view = mountBoth()
    openList(view)
    fireEvent.click(view.getByTestId('server-switch-b'))
    await waitFor(() => expect(view.getByTestId('server-switch-loader').textContent).toContain('Office'))
    expect(useAppStore.getState().drawerOpen).toBe(false)
    settle({ status: 'switched' })
    await waitFor(() => expect(view.queryByTestId('server-switch-loader')).toBeNull())
    expect(routerCalls()).toContainEqual({ kind: 'replace', target: '/cameras' })
  })

  it('needs-login clears the loader and opens the login', async () => {
    switchServer.mockResolvedValue({ status: 'needs-login' })
    const view = mountBoth()
    openList(view)
    fireEvent.click(view.getByTestId('server-switch-b'))
    await waitFor(() =>
      expect(routerCalls()).toContainEqual({ kind: 'push', target: { pathname: '/add-server', params: { url: 'http://b.test' } } }),
    )
    expect(view.queryByTestId('server-switch-loader')).toBeNull()
    expect(useAppStore.getState().serverSwitch).toBeNull()
  })

  it('a tap on the current server shows no loader and switches nothing', () => {
    const view = mountBoth()
    openList(view)
    fireEvent.click(view.getByTestId('server-switch-a'))
    expect(view.queryByTestId('server-switch-loader')).toBeNull()
    expect(useAppStore.getState().serverSwitch).toBeNull()
    expect(switchServer).not.toHaveBeenCalled()
  })

  it('a failed switch clears the loader and says why', async () => {
    setTestPlatform('web')
    switchServer.mockResolvedValue({ status: 'unknown-server' })
    const view = mountBoth()
    openList(view)
    fireEvent.click(view.getByTestId('server-switch-b'))
    expect(await screen.findByText('Could not switch server')).toBeTruthy()
    expect(view.queryByTestId('server-switch-loader')).toBeNull()
    expect(useAppStore.getState().serverSwitch).toBeNull()
  })

  it('a rejected switch clears the loader as well', async () => {
    setTestPlatform('web')
    switchServer.mockRejectedValue(new Error('offline'))
    const view = mountBoth()
    openList(view)
    fireEvent.click(view.getByTestId('server-switch-b'))
    expect(await screen.findByText('offline')).toBeTruthy()
    expect(useAppStore.getState().serverSwitch).toBeNull()
  })
})

describe('the server sheet adds and removes servers', () => {
  it('Add server opens the login for a new url and closes the drawer', () => {
    const view = mountScreen(React.createElement(AppDrawer))
    openList(view)
    fireEvent.click(view.getByTestId('server-add'))
    expect(routerCalls()).toContainEqual({ kind: 'push', target: '/add-server' })
    expect(useAppStore.getState().drawerOpen).toBe(false)
  })

  it('the trash icon asks for confirmation, then removes only that server', async () => {
    setTestPlatform('web')
    const view = mountScreen(React.createElement(AppDrawer))
    openList(view)
    fireEvent.click(view.getByTestId('server-remove-b'))
    expect(removeServer).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByText('Remove'))
    await waitFor(() => expect(removeServer).toHaveBeenCalledWith('b'))
  })
})

describe('"open at launch" and the bar', () => {
  it('"open at launch" shows the current choice and a pick changes the stored one', async () => {
    useAppStore.getState().setLaunchPreference('x')
    const view = mountScreen(React.createElement(AppDrawer), { hub: { 'apps.listApps': [APP_X] } })
    openMenu(view)
    await waitFor(() => expect(view.getByTestId('drawer-open-at-launch').textContent).toContain('Ex'))
    fireEvent.click(view.getByTestId('drawer-open-at-launch'))
    expect(view.getByTestId('launch-preference-sheet')).toBeTruthy()
    fireEvent.click(view.getByTestId('launch-option-last'))
    expect(useAppStore.getState().launchPreference).toBe('last')
    expect(view.queryByTestId('launch-preference-sheet')).toBeNull()
    openMenu(view)
    await waitFor(() => expect(view.getByTestId('drawer-open-at-launch').textContent).toContain('Last used'))
  })

  it('sign out closes the drawer and runs the existing sign-out', () => {
    const view = mountScreen(React.createElement(AppDrawer))
    openMenu(view)
    fireEvent.click(view.getByTestId('drawer-sign-out'))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().drawerOpen).toBe(false)
  })

  it('the home bar has no avatar at its right, only the one that opens the drawer', () => {
    const wrap = (c: React.ReactElement): React.JSX.Element => React.createElement(React.Fragment, null, c)
    const view = mountScreen(React.createElement(HomeBar, { variant: 'phone', pathname: '/cameras', wrapBell: wrap }))
    expect(view.queryByTestId('user-menu-button')).toBeNull()
    expect(view.getAllByTestId('drawer-menu-button')).toHaveLength(1)
  })
})
