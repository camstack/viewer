/**
 * @vitest-environment jsdom
 *
 * A session change drops the per-user caches (final re-review N2, same class
 * as I2).
 *
 * The notification-center lists (`['v2','nc',…]`) are not keyed by session.
 * Another user signing in on this device within their staleTime was served the
 * PREVIOUS user's target list as `answered` — and that list feeds the save
 * gate and the ownership filter, so his save could drop his own stored
 * targets. After a session change, the list must be pending again until the
 * hub answers for the NEW session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React, { useEffect } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { mountScreen } from '../../testing/mount.js'
import { useServer, type ServerContextValue } from '../ServerProvider.js'
import { useNcTargets } from '../../data/use-notification-center.js'
import type { Target } from '../../data/notification-center.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

interface Seen {
  targets: UseQueryResult<Target[]> | null
  server: ServerContextValue | null
}
const seen: Seen = { targets: null, server: null }

function Probe(): null {
  const targets = useNcTargets()
  const server = useServer()
  useEffect(() => {
    seen.targets = targets
    seen.server = server
  })
  return null
}

function actionOf(input: unknown): unknown {
  return input !== null && typeof input === 'object' && 'action' in input ? input.action : undefined
}

const HUB_CONFIG = { id: 'http://hub.test:8080', label: 'hub', serverUrl: 'http://hub.test:8080' }

afterEach(() => {
  cleanup()
  seen.targets = null
  seen.server = null
})

describe('a session change drops the previous user\'s NC caches (N2)', () => {
  it('sign in as A, cache A\'s targets, sign in as B: the list is pending, not A\'s answer', async () => {
    const session = { user: 'a' }
    mountScreen(React.createElement(Probe), {
      hub: {
        'addons.custom': (input?: unknown): unknown => {
          if (actionOf(input) !== 'nc.listMyTargets') throw new Error('NOT_FOUND')
          // B's answer never arrives: whatever the list shows after the switch
          // is either "pending" or a leftover.
          if (session.user === 'b') return new Promise(() => undefined)
          return { targets: [{ id: 't-a', name: 'A phone', kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }] }
        },
      },
    })
    await act(async () => {
      await seen.server?.save(HUB_CONFIG, { token: 'token-a', refreshToken: null })
    })
    await vi.waitFor(() => expect(seen.targets?.data?.map((t) => t.id)).toEqual(['t-a']))

    session.user = 'b'
    await act(async () => {
      await seen.server?.save(HUB_CONFIG, { token: 'token-b', refreshToken: null })
    })
    await vi.waitFor(() => expect(seen.targets?.data).toBeUndefined())
    expect(seen.targets?.isPending).toBe(true)
  })

  it('a silent renewal of the SAME session keeps the answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ result: { data: { json: { token: 'token-a-renewed', refreshToken: 'csr_2' } } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    mountScreen(React.createElement(Probe), {
      hub: {
        'addons.custom': (input?: unknown): unknown => {
          if (actionOf(input) !== 'nc.listMyTargets') throw new Error('NOT_FOUND')
          return { targets: [{ id: 't-a', name: 'A phone', kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }] }
        },
      },
    })
    await act(async () => {
      await seen.server?.save(HUB_CONFIG, { token: 'token-a', refreshToken: 'csr_1' })
    })
    await vi.waitFor(() => expect(seen.targets?.data?.map((t) => t.id)).toEqual(['t-a']))
    await act(async () => {
      await seen.server?.renewSession('scheduled')
    })
    expect(seen.server?.token).toBe('token-a-renewed')
    expect(seen.server?.sessionToken).toBe('token-a')
    expect(seen.targets?.data?.map((t) => t.id)).toEqual(['t-a'])
    vi.unstubAllGlobals()
  })
})
