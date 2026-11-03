/**
 * @vitest-environment jsdom
 *
 * 1.0.678 showed the root boundary on an iPhone and left no evidence: no line
 * reached the hub (the throw was before the first connect), and the screen
 * claimed the details "have been sent". The boundary now keeps the failure on
 * the device (message + JS stack + component stack), survives the app being
 * backgrounded on the error screen, and says so truthfully.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'

import { ExitMarkerRecorder, type ExitMarkerPort } from '../exit-marker.js'
import { parseExitMarker, withComponentStack } from '../crash-record.js'

const recorderMock = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('../exit-marker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../exit-marker.js')>()
  return { ...actual, getExitMarkerRecorder: () => recorderMock.value }
})
vi.mock('../logger.js', () => ({
  log: { error: () => undefined, warn: () => undefined, info: () => undefined },
  flushLogsNow: () => Promise.resolve(),
}))

const { RootErrorBoundary } = await import('../../app/RootErrorBoundary.js')

function storage(): { port: ExitMarkerPort; value: string | null } {
  const state: { port: ExitMarkerPort; value: string | null } = {
    value: null,
    port: {
      read: () => Promise.resolve(state.value),
      write: (v) => {
        state.value = v
        return Promise.resolve()
      },
    },
  }
  return state
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function Boom(): React.ReactElement {
  throw new Error('widget exploded')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('root error boundary evidence', () => {
  it('shows the message, does not claim it was sent, and persists message + component stack', async () => {
    const store = storage()
    recorderMock.value = new ExitMarkerRecorder(store.port)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(React.createElement(RootErrorBoundary, null, React.createElement(Boom)))
    await settle()

    expect(screen.getByTestId('root-error-detail').textContent).toContain('widget exploded')
    expect(screen.queryByText(/have been sent/)).toBeNull()
    expect(screen.getByText(/saved on this device/)).toBeTruthy()

    const marker = parseExitMarker(store.value)
    expect(marker?.kind).toBe('render-error')
    expect(marker?.message).toContain('widget exploded')
    expect(marker?.stack).toContain('component stack:')
    expect(marker?.stack).toContain('Boom')
  })

  it('a backgrounded/running write after a failure does not erase it', async () => {
    const store = storage()
    const recorder = new ExitMarkerRecorder(store.port)
    await recorder.record('render-error', { message: 'Error: x', stack: null })
    await recorder.record('backgrounded')
    await recorder.arm()
    expect(parseExitMarker(store.value)?.kind).toBe('render-error')
  })

  it('withComponentStack bounds and appends', () => {
    const out = withComponentStack({ message: 'm', stack: 's' }, '\n    at A')
    expect(out.stack).toBe('s\ncomponent stack:\n    at A')
    expect(withComponentStack({ message: 'm', stack: null }, '')).toEqual({ message: 'm', stack: null })
  })
})
