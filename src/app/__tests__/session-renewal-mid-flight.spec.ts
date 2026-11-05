/**
 * @vitest-environment jsdom
 *
 * A cold start with an expired access token renews in the same commit that
 * flips `loading` off, while the connected subtree (and with it the live
 * System) mounts only LATER — during the refresh round trip. The renewal must
 * install the new token on the System that exists when it LANDS, not on the
 * one it saw when it started (none), and an `unauthorized` caller that joined
 * the flight must still get its reconnect.
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
  readonly token: () => string
}

/** Built with the expired token: the SDK dropped it, the socket is anonymous. */
function anonymousSystem(): FakeSystem {
  let current = EXPIRED
  let handshaken: string | undefined
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
    token: () => current,
  }
}

const RENEWED_OUTCOME: RenewOutcome = { status: 'renewed', token: RENEWED, refreshToken: 'r2', supersededToken: null }

function deferredRenewer(): { renewer: SessionRenewer; settle: () => void } {
  let settle: () => void = () => undefined
  const renewer: SessionRenewer = {
    renew: vi.fn(
      () =>
        new Promise<RenewOutcome>((resolve) => {
          settle = () => resolve(RENEWED_OUTCOME)
        }),
    ),
    forget: vi.fn(),
  }
  return { renewer, settle: () => settle() }
}

function mount(renewer: SessionRenewer) {
  return renderHook(() =>
    useSessionRenewal({
      renewer,
      server: HUB,
      token: EXPIRED,
      onRenewed: () => undefined,
      onSignedOut: async () => undefined,
    }),
  )
}

afterEach(() => cleanup())

describe('session renewal × a System that attaches while the refresh is in flight', () => {
  it('lands the renewed token on the System that exists when the refresh answers, with exactly one reconnect', async () => {
    const { renewer, settle } = deferredRenewer()
    const hook = mount(renewer)
    let started: Promise<RenewOutcome> = Promise.resolve({ status: 'unavailable' })
    await act(async () => {
      started = hook.result.current.renewSession('resume') // no System yet
    })
    const system = anonymousSystem()
    hook.result.current.attachSystem(() => system) // the subtree mounts mid-flight
    await act(async () => {
      settle()
      await started
    })

    expect(system.token()).toBe(RENEWED)
    expect(system.reconnects()).toBe(1)
    expect(system.isSocketTokenStale()).toBe(false)
    // A late UNAUTHORIZED from the old token: swallowed, no second reconnect, no stranding.
    await act(async () => {
      await hook.result.current.renewSession('unauthorized')
    })
    expect(system.reconnects()).toBe(1)
    expect(renewer.renew).toHaveBeenCalledTimes(1)
  })

  it('an unauthorized joiner keeps its reconnect when the System attaches mid-flight', async () => {
    const { renewer, settle } = deferredRenewer()
    const hook = mount(renewer)
    let first: Promise<RenewOutcome> = Promise.resolve({ status: 'unavailable' })
    await act(async () => {
      first = hook.result.current.renewSession('resume')
    })
    const system = anonymousSystem()
    // The socket happens to carry the right handshake already: only the
    // `refused` flag of the joiner can ask for the reconnect.
    system.reconnect()
    system.setToken(RENEWED)
    system.reconnect()
    const before = system.reconnects()
    hook.result.current.attachSystem(() => system)
    let joined: Promise<RenewOutcome> = Promise.resolve({ status: 'unavailable' })
    await act(async () => {
      joined = hook.result.current.renewSession('unauthorized')
    })
    await act(async () => {
      settle()
      await Promise.all([first, joined])
    })

    expect(system.token()).toBe(RENEWED)
    expect(system.reconnects()).toBe(before + 1)
  })

  it('a renewal the SDK asked for (credential) installs the token and leaves the handshake to the SDK', async () => {
    const { renewer, settle } = deferredRenewer()
    const hook = mount(renewer)
    const system = anonymousSystem()
    hook.result.current.attachSystem(() => system)
    let asked: Promise<void> = Promise.resolve()
    await act(async () => {
      asked = hook.result.current.refreshCredential()
    })
    await act(async () => {
      settle()
      await asked
    })

    expect(system.token()).toBe(RENEWED)
    expect(system.reconnects()).toBe(0)
  })
})
