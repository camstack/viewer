// @vitest-environment jsdom
/**
 * The wiring of the resume reconcile, MOUNTED: a reconnection refetches the
 * screen in front of the operator, not only the volatile device keys. The
 * People page kept the answer it had before the app went to the background
 * (or the error of a socket that died under it) until a pull-to-refresh
 * (operator, 2026-10-22).
 */
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'

import type { ConnState } from '../../connection/recheck-policy.js'
import { emitAppState, setTestAppState } from '../../testing/app-state-control.js'
import { isVolatileQueryKey } from '../resume-reconcile.js'
import { useResumeReconcile } from '../use-resume-reconcile.js'

const connection = vi.hoisted(() => ({ state: 'connected' as ConnState }))

vi.mock('../../connection/ConnectionProvider.js', () => ({
  useConnection: () => ({ controller: {}, state: connection.state, startingUp: false }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  connection.state = 'connected'
  setTestAppState('active')
})

function Screen({ fetchFaces }: { readonly fetchFaces: () => Promise<string[]> }): null {
  useResumeReconcile()
  useQuery({ queryKey: ['v2', 'face-review-faces', { filter: 'unassigned' }], queryFn: fetchFaces, staleTime: 60_000 })
  return null
}

describe('useResumeReconcile', () => {
  it('a resume refetches the visible screen’s queries once the socket is back, beyond the volatile keys', async () => {
    let now = 1_789_936_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    setTestAppState('active')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const fetchFaces = vi.fn(async () => ['f1'])
    const tree = (): React.ReactElement =>
      React.createElement(QueryClientProvider, { client }, React.createElement(Screen, { fetchFaces }))
    const view = render(tree())
    await waitFor(() => expect(fetchFaces).toHaveBeenCalledTimes(1))

    // The app leaves: the socket is suspended…
    act(() => emitAppState('background'))
    connection.state = 'connecting'
    act(() => view.rerender(tree()))
    // …a minute later it is back in front, the socket still reopening…
    now += 60_000
    act(() => emitAppState('active'))
    expect(fetchFaces).toHaveBeenCalledTimes(1)
    // …and the reconnection is the moment the screen is asked again.
    connection.state = 'connected'
    act(() => view.rerender(tree()))

    // Fresh for another minute by its own staleTime: only the pass refetches it.
    await waitFor(() => expect(fetchFaces).toHaveBeenCalledTimes(2))
  })

  it('tells the volatile device keys from every other query', () => {
    expect(isVolatileQueryKey(['v2', 'cameras'])).toBe(true)
    expect(isVolatileQueryKey(['v2', 'battery', 42])).toBe(true)
    expect(isVolatileQueryKey(['v2', 'face-review-faces'])).toBe(false)
    expect(isVolatileQueryKey(['v2'])).toBe(false)
  })
})
