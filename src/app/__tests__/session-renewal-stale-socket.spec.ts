/**
 * @vitest-environment jsdom
 *
 * A renewal must leave the live WebSocket authenticated (planning#357).
 *
 * The socket authenticates once, at its handshake. A cold start after the
 * access token expired (#344) builds the System with the expired token, and
 * the SDK opens the socket ANONYMOUSLY (it drops an expired token). The
 * background renewal then swaps the token in place — and if nothing joined
 * it as `unauthorized` while it was in flight, the socket stays anonymous:
 * every protected call answers UNAUTHORIZED, and the 15 s straggler window
 * swallows each report. Only killing the app recovered.
 *
 * The fake System models the SDK's handshake bookkeeping: `reconnect()`
 * re-handshakes with the current token, `isSocketTokenStale()` compares them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { useSessionRenewal, type LiveSystem } from '../use-session-renewal.js'
import type { SessionRenewer } from '../../auth/session-renewer.js'
import type { RenewOutcome } from '../../auth/refresh-session.js'
import type { ServerConfig } from '../../connection/server-store.js'

function jwt(expSec: number): string {
  return `h.${Buffer.from(JSON.stringify({ exp: expSec })).toString('base64')}.s`
}
const EXPIRED = jwt(Math.floor(Date.now() / 1000) - 3600)
const RENEWED = jwt(Math.floor(Date.now() / 1000) + 7200)

const HUB: ServerConfig = { id: 'http://hub.test:8080', label: 'hub', serverUrl: 'http://hub.test:8080' }

interface FakeSystem extends LiveSystem {
  readonly reconnects: () => number
}

/** `handshake` = the token the open socket authenticated with; `undefined` = anonymous. */
function fakeSystem(token: string, handshake: string | undefined): FakeSystem {
  let current = token
  let handshaken = handshake
  let reconnects = 0
  return {
    serverUrl: HUB.serverUrl,
    trpcClient: {},
    setToken: (next) => {
      current = next
    },
    reconnect: () => {
      reconnects += 1
      handshaken = current
    },
    isSocketTokenStale: () => handshaken !== current,
    reconnects: () => reconnects,
  }
}

function renewerAnswering(outcome: RenewOutcome): SessionRenewer {
  return { renew: vi.fn(async () => outcome), forget: vi.fn() }
}

const RENEWED_OUTCOME: RenewOutcome = {
  status: 'renewed',
  token: RENEWED,
  refreshToken: 'r2',
  supersededToken: null,
}

function mount(renewer: SessionRenewer, system: FakeSystem) {
  const hook = renderHook(() =>
    useSessionRenewal({
      renewer,
      server: HUB,
      token: EXPIRED,
      onRenewed: () => undefined,
      onSignedOut: async () => undefined,
    }),
  )
  hook.result.current.attachSystem(() => system)
  return hook
}

afterEach(() => {
  cleanup()
})

describe('session renewal × a socket handshaken with an old token', () => {
  it('reconnects after a cold-start renewal when the socket opened anonymously', async () => {
    const system = fakeSystem(EXPIRED, undefined)
    const hook = mount(renewerAnswering(RENEWED_OUTCOME), system)

    await act(async () => {
      await hook.result.current.renewSession('resume')
    })

    expect(system.isSocketTokenStale()).toBe(false)
    expect(system.reconnects()).toBe(1)
  })

  it('an UNAUTHORIZED inside the straggler window reconnects a socket that is still stale', async () => {
    const system = fakeSystem(EXPIRED, undefined)
    const renewer = renewerAnswering(RENEWED_OUTCOME)
    const hook = mount(renewer, system)
    await act(async () => {
      await hook.result.current.renewSession('resume')
    })
    // A resume reconnect raced the renewal and re-handshook with the old token.
    system.setToken(EXPIRED)
    system.reconnect()
    system.setToken(RENEWED)
    const before = system.reconnects()

    await act(async () => {
      await hook.result.current.renewSession('unauthorized')
    })

    expect(renewer.renew).toHaveBeenCalledTimes(1)
    expect(system.reconnects()).toBe(before + 1)
    expect(system.isSocketTokenStale()).toBe(false)
  })

  it('does not reconnect a socket that already carries the renewed token', async () => {
    const system = fakeSystem(EXPIRED, undefined)
    const hook = mount(renewerAnswering(RENEWED_OUTCOME), system)
    await act(async () => {
      await hook.result.current.renewSession('resume')
    })
    const before = system.reconnects()

    await act(async () => {
      await hook.result.current.renewSession('unauthorized')
    })

    expect(system.reconnects()).toBe(before)
  })
})
