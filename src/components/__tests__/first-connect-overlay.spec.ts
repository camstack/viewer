/**
 * @vitest-environment jsdom
 *
 * The central overlay of the INITIAL connection (operator, 2026-11-02): it
 * exists only until the connection is `connected` for the first time, never
 * flashes, offers Retry / Change server after 10 s, and never comes back on a
 * later reconnect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

import i18n from '../../app/i18n.js'
import { ThemeProvider } from '../../theme/theme-provider.js'
import { resetRouterStub, routerCalls } from '../../testing/native-stubs/expo-router.js'
import {
  FIRST_CONNECT_ACTIONS_MS,
  FIRST_CONNECT_DELAY_MS,
} from '../../connection/first-connect.js'

const conn = vi.hoisted(() => ({
  state: 'connecting' as 'connecting' | 'connected' | 'disconnected',
  retries: 0,
}))

vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }))
vi.mock('../../connection/ConnectionProvider.js', () => ({
  useConnection: () => ({
    controller: { retryNow: () => { conn.retries += 1 } },
    state: conn.state,
    startingUp: false,
  }),
}))
vi.mock('../../app/ServerProvider.js', () => ({
  useServer: () => ({ server: { id: 'a', label: 'Home hub', serverUrl: 'http://hub.test' } }),
}))

const { FirstConnectOverlay } = await import('../FirstConnectOverlay.js')

const tree = (): React.ReactElement =>
  React.createElement(ThemeProvider, null, React.createElement(FirstConnectOverlay))

function setState(next: typeof conn.state, rerender: (el: React.ReactElement) => void): void {
  conn.state = next
  act(() => rerender(tree()))
}

function elapse(ms: number): void {
  for (let left = ms; left > 0; left -= 50) act(() => void vi.advanceTimersByTime(Math.min(50, left)))
}

const TEXT = 'Connecting to Home hub…'

beforeEach(async () => {
  vi.useFakeTimers()
  conn.state = 'connecting'
  conn.retries = 0
  resetRouterStub()
  await i18n.changeLanguage('en')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('FirstConnectOverlay', () => {
  it('does not paint before the delay, then names the server', () => {
    render(tree())
    elapse(FIRST_CONNECT_DELAY_MS - 50)
    expect(screen.queryByText(TEXT)).toBeNull()
    elapse(200)
    expect(screen.getByText(TEXT)).toBeTruthy()
    expect(screen.queryByText('Retry')).toBeNull()
  })

  it('never shows when the first connection lands within the delay', () => {
    const { rerender } = render(tree())
    elapse(FIRST_CONNECT_DELAY_MS - 100)
    setState('connected', rerender)
    elapse(FIRST_CONNECT_ACTIONS_MS * 2)
    expect(screen.queryByText(TEXT)).toBeNull()
  })

  it('goes away on the first connection and never returns on a later flap', () => {
    const { rerender } = render(tree())
    elapse(1_000)
    expect(screen.getByText(TEXT)).toBeTruthy()
    setState('connected', rerender)
    elapse(500)
    expect(screen.queryByText(TEXT)).toBeNull()
    setState('disconnected', rerender)
    elapse(FIRST_CONNECT_ACTIONS_MS * 2)
    setState('connecting', rerender)
    elapse(FIRST_CONNECT_ACTIONS_MS * 2)
    expect(screen.queryByText(TEXT)).toBeNull()
  })

  it('a connecting/connected flap while it is up does not remount the card', () => {
    const { rerender } = render(tree())
    elapse(1_000)
    const card = screen.getByTestId('first-connect-card')
    setState('connecting', rerender)
    expect(screen.getByTestId('first-connect-card')).toBe(card)
  })

  it('offers Retry and Change server after 10 s, spinner kept', () => {
    render(tree())
    elapse(FIRST_CONNECT_ACTIONS_MS - 500)
    expect(screen.queryByText('Retry')).toBeNull()
    elapse(1_000)
    expect(screen.getByText('Retry')).toBeTruthy()
    expect(screen.getByText('Change server')).toBeTruthy()
    expect(screen.getByText(TEXT)).toBeTruthy()
  })

  it('Retry asks the connection to redial', () => {
    render(tree())
    elapse(FIRST_CONNECT_ACTIONS_MS + 500)
    fireEvent.click(screen.getByText('Retry'))
    expect(conn.retries).toBe(1)
  })

  it('Change server opens the existing server list (Settings → Account)', () => {
    render(tree())
    elapse(FIRST_CONNECT_ACTIONS_MS + 500)
    fireEvent.click(screen.getByText('Change server'))
    expect(routerCalls()).toContainEqual({ kind: 'push', target: '/settings' })
  })

  it('speaks Italian', async () => {
    await i18n.changeLanguage('it')
    render(tree())
    elapse(FIRST_CONNECT_ACTIONS_MS + 500)
    expect(screen.getByText('Connessione a Home hub…')).toBeTruthy()
    expect(screen.getByText('Riprova')).toBeTruthy()
    expect(screen.getByText('Cambia server')).toBeTruthy()
  })
})
