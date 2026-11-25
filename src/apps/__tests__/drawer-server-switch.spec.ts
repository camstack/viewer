/**
 * @vitest-environment jsdom
 *
 * planning#716 P1: with two saved servers the drawer's bottom block offers the
 * switch; it opens the server list, and a tap on the other server runs the
 * existing `switchServer` flow. The account sheet no longer lists servers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { useAppStore } from '../app-store.js'
import { AppDrawer } from '../AppDrawer.js'
import { AccountSheet } from '../AccountSheet.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const switchServer = vi.fn(() => Promise.resolve({ status: 'switched' as const }))
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
  switchServer.mockClear()
  useAppStore.getState().setDrawerOpen(true)
  useAppStore.getState().setAccountOpen(false)
})
afterEach(cleanup)

describe('the drawer bottom with several servers', () => {
  it('shows the current server and the switch, which lists the servers and switches through the existing flow', async () => {
    const view = mountScreen(React.createElement(AppDrawer))
    expect(view.getByTestId('drawer-account-server').textContent).toBe('Home')
    fireEvent.click(view.getByTestId('drawer-switch-server'))
    expect(view.getByTestId('server-switch-sheet')).toBeTruthy()
    fireEvent.click(view.getByTestId('server-switch-b'))
    await waitFor(() => expect(switchServer).toHaveBeenCalledWith('b'))
  })

  it('no longer lists the servers in the account sheet', () => {
    useAppStore.getState().setDrawerOpen(false)
    useAppStore.getState().setAccountOpen(true)
    const view = mountScreen(React.createElement(AccountSheet))
    expect(view.getByTestId('account-sheet')).toBeTruthy()
    expect(view.queryByTestId('server-switch-b')).toBeNull()
    expect(view.queryByText('Office')).toBeNull()
  })
})
