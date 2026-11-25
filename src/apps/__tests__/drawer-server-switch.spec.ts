/**
 * @vitest-environment jsdom
 *
 * planning#716 P1: with two saved servers the drawer's bottom block offers the
 * switch; the list runs the existing `switchServer` flow and the drawer closes
 * with the tap, whatever the outcome. "Open at launch" lives in the same block.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { routerCalls } from '../../testing/native-stubs/expo-router.js'
import { useAppStore } from '../app-store.js'
import { AppDrawer } from '../AppDrawer.js'
import { HomeBar } from '../../navigation/HomeBar.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

type Outcome = { status: 'switched' } | { status: 'needs-login' }
const switchServer = vi.fn((_id: string): Promise<Outcome> => Promise.resolve({ status: 'switched' }))
const SAVED = [
  { id: 'a', label: 'Home', serverUrl: 'http://a.test', lastUsedAt: 2 },
  { id: 'b', label: 'Office', serverUrl: 'http://b.test', lastUsedAt: 1 },
]

vi.mock('../../app/ServerProvider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/ServerProvider.js')>()
  return {
    ...actual,
    useServer: () => ({ ...actual.useServer(), servers: SAVED, server: SAVED[0], switchServer }),
  }
})

beforeEach(() => {
  switchServer.mockReset()
  switchServer.mockResolvedValue({ status: 'switched' })
  useAppStore.getState().setDrawerOpen(true)
})
afterEach(cleanup)

const openList = (view: ReturnType<typeof mountScreen>): void => {
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

describe('"open at launch" and the bar', () => {
  it('"open at launch" is in the drawer bottom and stores the choice', () => {
    const view = mountScreen(React.createElement(AppDrawer))
    fireEvent.click(view.getByTestId('drawer-open-at-launch'))
    expect(view.getByTestId('launch-preference-sheet')).toBeTruthy()
    fireEvent.click(view.getByTestId('launch-option-last'))
    expect(useAppStore.getState().launchPreference).toBe('last')
    expect(view.queryByTestId('launch-preference-sheet')).toBeNull()
  })

  it('the home bar has no avatar at its right, only the one that opens the drawer', () => {
    const wrap = (c: React.ReactElement): React.JSX.Element => React.createElement(React.Fragment, null, c)
    const view = mountScreen(React.createElement(HomeBar, { variant: 'phone', pathname: '/cameras', wrapBell: wrap }))
    expect(view.queryByTestId('user-menu-button')).toBeNull()
    expect(view.getAllByTestId('drawer-menu-button')).toHaveLength(1)
  })
})
