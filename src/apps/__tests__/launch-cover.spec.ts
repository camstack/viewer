/**
 * @vitest-environment jsdom
 *
 * planning#763: the launch loader covers the Viewer only while it can end. An offline hub, a
 * hub that never answers and a failed catalog all clear it.
 */
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { resetStubConnection, setStubConnection } from '../../testing/connection-stub.js'
import { LAUNCH_COVER_MAX_MS, launchCoversViewer } from '../app-launch.js'
import { useAppStore } from '../app-store.js'
import { AppHost } from '../AppHost.js'

vi.mock('../../connection/ConnectionProvider.js', async () => (await import('../../testing/connection-stub.js')).connectionStubModule())

const base = { hydrated: true, settled: false, preference: 'admin', lastApp: null, connection: 'connected' } as const

describe('launchCoversViewer truth table', () => {
  it('covers an undecided launch into an embedded app while the hub is reachable or connecting', () => {
    expect(launchCoversViewer(base)).toBe(true)
    expect(launchCoversViewer({ ...base, connection: 'connecting' })).toBe(true)
    expect(launchCoversViewer({ ...base, hydrated: false, preference: 'last' })).toBe(true)
  })
  it('never covers an offline hub, a settled launch or a Viewer launch', () => {
    expect(launchCoversViewer({ ...base, connection: 'disconnected' })).toBe(false)
    expect(launchCoversViewer({ ...base, settled: true })).toBe(false)
    expect(launchCoversViewer({ ...base, preference: 'last', lastApp: null })).toBe(false)
  })
})

describe('the loader on a mounted AppHost', () => {
  beforeEach(() => {
    resetStubConnection()
    useAppStore.setState({ hydrated: true, launchSettled: false, launchPreference: 'admin', lastApp: null, active: { appId: null }, carried: null })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    resetStubConnection()
  })

  it('an offline hub never shows it', () => {
    setStubConnection({ state: 'disconnected' })
    const view = mountScreen(React.createElement(AppHost))
    expect(view.queryByTestId('launch-loader')).toBeNull()
  })

  it('a hub that never answers shows it, then gives up and opens the Viewer', async () => {
    vi.useFakeTimers()
    setStubConnection({ state: 'connecting', hasSystem: false })
    const view = mountScreen(React.createElement(AppHost))
    expect(view.getByTestId('launch-loader')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LAUNCH_COVER_MAX_MS)
    })
    expect(view.queryByTestId('launch-loader')).toBeNull()
    expect(useAppStore.getState()).toMatchObject({ launchSettled: true, active: { appId: null } })
  })

  it('a catalog that failed clears it', async () => {
    const view = mountScreen(React.createElement(AppHost), { hub: { 'apps.listApps': null } })
    await vi.waitFor(() => expect(view.queryByTestId('launch-loader')).toBeNull())
    expect(useAppStore.getState().launchSettled).toBe(true)
  })
})
