/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { bundledCamstack } from '@camstack/types/client'
import { paintKind, resetPaletteView } from '../../../shared/palette.js'
import { resetPaletteLog, shouldRefreshPalette, usePalette } from '../use-palette.js'

interface HubStub {
  state: string
  serverUrl: string | null
  payload: unknown
  fail: string | null
}

const hub = vi.hoisted((): HubStub => ({
  state: 'connected',
  serverUrl: 'http://hub.test',
  payload: null,
  fail: null,
}))

vi.mock('../../connection/ConnectionProvider.js', () => ({
  useConnection: () => ({
    state: hub.state,
    controller: {
      getSystem: () =>
        hub.serverUrl === null
          ? null
          : {
              serverUrl: hub.serverUrl,
              trpcClient: {
                displayPalette: {
                  getPalette: {
                    query: (): Promise<unknown> => {
                      if (hub.fail !== null) return Promise.reject(new Error(hub.fail))
                      return Promise.resolve(hub.payload)
                    },
                  },
                },
              },
            },
    },
  }),
}))

vi.mock('../../lib/logger.js', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

interface WrapperProps {
  readonly children: React.ReactNode
}

function wrapper(): (props: WrapperProps) => React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function PaletteWrapper({ children }: WrapperProps): React.JSX.Element {
    return React.createElement(QueryClientProvider, { client }, children)
  }
}

function ready(personHex: string): unknown {
  const base = bundledCamstack()
  const person = base.swatches.person
  if (person === undefined || person.form !== 'solid') throw new Error('bundled person swatch missing')
  return { ...base, swatches: { ...base.swatches, person: { ...person, hex: personHex } } }
}

describe('shouldRefreshPalette', () => {
  it('is only the rising edge into connected', () => {
    expect(shouldRefreshPalette(null, 'connected')).toBe(false)
    expect(shouldRefreshPalette('connected', 'connected')).toBe(false)
    expect(shouldRefreshPalette('disconnected', 'disconnected')).toBe(false)
    expect(shouldRefreshPalette('disconnected', 'connected')).toBe(true)
  })
})

describe('usePalette', () => {
  beforeEach(() => {
    resetPaletteView()
    resetPaletteLog()
    hub.state = 'connected'
    hub.serverUrl = 'http://hub.test'
    hub.payload = ready('#112233')
    hub.fail = null
  })

  it('paints a ready hub palette', async () => {
    const { result } = renderHook(() => usePalette(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.origin).toBe('hub'))
    expect(paintKind(result.current, 'person')).toBe('#112233')
  })

  it('falls back to the bundled preset when the hub is unknown', async () => {
    hub.payload = { status: 'unknown', reason: 'no-provider' }
    const bundled = paintKind(
      { ready: bundledCamstack(), origin: 'pending', reason: null, serverUrl: null },
      'person',
    )
    const { result } = renderHook(() => usePalette(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.origin).toBe('unknown'))
    expect(result.current.reason).toBe('no-provider')
    expect(paintKind(result.current, 'person')).toBe(bundled)
  })

  it('refetches when the connection rises back to connected', async () => {
    const { result, rerender } = renderHook(() => usePalette(), { wrapper: wrapper() })
    await waitFor(() => expect(paintKind(result.current, 'person')).toBe('#112233'))

    hub.payload = ready('#445566')
    hub.state = 'disconnected'
    rerender()
    expect(result.current.origin).toBe('hub')
    expect(paintKind(result.current, 'person')).toBe('#112233')

    hub.state = 'connected'
    rerender()
    await waitFor(() => expect(paintKind(result.current, 'person')).toBe('#445566'))
  })
})
