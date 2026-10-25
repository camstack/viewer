/**
 * @vitest-environment jsdom
 *
 * The ONE hub-connection overlay (operator, 2026-10-23): mounted once at the
 * app root, silent through a normal connect, and the only place in the app
 * that states the hub connection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import '../../app/i18n.js'
import i18n from '../../app/i18n.js'
import { ThemeProvider } from '../../theme/theme-provider.js'
import { HUB_STATUS_GRACE_MS, HUB_STATUS_RESTORED_MS } from '../../connection/hub-status.js'

const conn = vi.hoisted(() => ({
  state: 'connecting' as 'connecting' | 'connected' | 'disconnected',
  startingUp: false,
  retries: 0,
}))

vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }))
vi.mock('../../connection/ConnectionProvider.js', () => ({
  useConnection: () => ({
    controller: { retryNow: () => { conn.retries += 1 } },
    state: conn.state,
    startingUp: conn.startingUp,
  }),
}))

const { HubConnectionOverlay } = await import('../HubConnectionOverlay.js')

function tree(): React.ReactElement {
  return React.createElement(ThemeProvider, null, React.createElement(HubConnectionOverlay))
}

function setState(next: typeof conn.state, rerender: (el: React.ReactElement) => void): void {
  conn.state = next
  act(() => rerender(tree()))
}

/** Advance in small steps, letting React commit between them: each timer
 *  here arms the next one from an effect (grace → fade-in delay). */
function elapse(ms: number): void {
  for (let left = ms; left > 0; left -= 50) {
    act(() => {
      vi.advanceTimersByTime(Math.min(50, left))
    })
  }
}

beforeEach(async () => {
  vi.useFakeTimers()
  conn.state = 'connecting'
  conn.startingUp = false
  conn.retries = 0
  await i18n.changeLanguage('en')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('HubConnectionOverlay', () => {
  it('shows NOTHING when the hub connects within the grace', () => {
    const { rerender } = render(tree())
    elapse(HUB_STATUS_GRACE_MS - 200)
    setState('connected', rerender)
    elapse(HUB_STATUS_GRACE_MS * 3)
    expect(screen.queryByText('Connecting to the hub…')).toBeNull()
    expect(screen.queryByText('Back online')).toBeNull()
  })

  it('says "Connecting to the hub…" only once the grace has passed', () => {
    render(tree())
    elapse(HUB_STATUS_GRACE_MS - 1)
    expect(screen.queryByText('Connecting to the hub…')).toBeNull()
    elapse(1_000)
    expect(screen.getByText('Connecting to the hub…')).toBeTruthy()
  })

  it('offline offers Retry, which asks the controller to redial', () => {
    const { rerender } = render(tree())
    elapse(HUB_STATUS_GRACE_MS + 1_000)
    setState('disconnected', rerender)
    elapse(500)
    expect(screen.getByText('Hub unreachable')).toBeTruthy()
    fireEvent.click(screen.getByTestId('hub-status-retry'))
    expect(conn.retries).toBe(1)
  })

  it('a surfaced loss ends with a brief "Back online", then nothing', () => {
    const { rerender } = render(tree())
    elapse(HUB_STATUS_GRACE_MS + 1_000)
    setState('connected', rerender)
    expect(screen.getByText('Back online')).toBeTruthy()
    elapse(HUB_STATUS_RESTORED_MS + 1_000)
    expect(screen.queryByText('Back online')).toBeNull()
  })

  it('speaks Italian', async () => {
    await i18n.changeLanguage('it')
    render(tree())
    elapse(HUB_STATUS_GRACE_MS + 1_000)
    expect(screen.getByText("Connessione all'hub…")).toBeTruthy()
  })
})

// ── wiring: one mount, at the root, and no page states the hub connection ──

const ROOT = process.cwd()

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') return []
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('HubConnectionOverlay wiring', () => {
  const files = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'app'))]

  it('is mounted exactly once, in the signed-in root layout', () => {
    const mounts = files.filter((f) => readFileSync(f, 'utf8').includes('<HubConnectionOverlay'))
    expect(mounts.map((f) => relative(ROOT, f))).toEqual([join('app', '(app)', '_layout.tsx')])
    const layout = readFileSync(join(ROOT, 'app', '(app)', '_layout.tsx'), 'utf8')
    expect(layout.match(/<HubConnectionOverlay \/>/g)).toHaveLength(1)
  })

  it('the per-page banner is gone', () => {
    const left = files.filter((f) => readFileSync(f, 'utf8').includes('ConnectionBanner'))
    expect(left.map((f) => relative(ROOT, f))).toEqual([])
  })
})
