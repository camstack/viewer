/**
 * The hub closes the socket of a revoked session with 4401 `session-ended`.
 * The controller reads that off the socket's connection state and reports it as
 * an UNAUTHORIZED, so the app renews once and signs out if the hub refuses -
 * instead of redialling with the dead token (2026-10-16).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CandidateRaceOutcome } from '../candidate-probe.js'
import { SystemController } from '../system-controller.js'

const { createSystem, sockets } = vi.hoisted(() => {
  interface FakeSocket {
    readonly emit: (state: unknown) => void
    readonly unsubscribe: ReturnType<typeof vi.fn>
  }
  const sockets: FakeSocket[] = []
  const makeSocket = () => {
    const observers: Array<{ next(state: unknown): void }> = []
    const unsubscribe = vi.fn()
    const socket = {
      close: vi.fn(),
      connectionState: {
        subscribe: (observer: { next(state: unknown): void }) => {
          observers.push(observer)
          return { unsubscribe }
        },
      },
    }
    sockets.push({ emit: (state) => observers.forEach((o) => o.next(state)), unsubscribe })
    return socket
  }
  return {
    sockets,
    createSystem: vi.fn(() => ({
      serverUrl: 'https://public:4443',
      switchServerUrl: vi.fn(),
      reconnect: vi.fn(),
      trpcClient: { auth: { me: { query: vi.fn(async () => ({ id: 1 })) } } },
      wsClient: makeSocket(),
      close: vi.fn(),
    })),
  }
})

vi.mock('@camstack/sdk', () => ({ createSystem }))

const raceSeam = async (): Promise<CandidateRaceOutcome> => ({ winner: null, results: [] })

const closedWith = (code: number) =>
  Object.assign(new Error('WebSocket closed'), { cause: { code, reason: 'session-ended' } })

async function connected() {
  const onUnauthorized = vi.fn()
  const ctrl = new SystemController({
    serverUrl: 'https://public:4443',
    candidates: ['https://public:4443'],
    raceCandidatesImpl: raceSeam,
  })
  ctrl.subscribe({ onStateChange: () => undefined, onUnauthorized })
  await ctrl.connect()
  await ctrl.routeSettled()
  return { ctrl, onUnauthorized }
}

beforeEach(() => {
  sockets.length = 0
  createSystem.mockClear()
})

describe('a socket closed by the hub with session-ended', () => {
  it('is reported as UNAUTHORIZED once per close', async () => {
    const { onUnauthorized } = await connected()
    sockets[0]?.emit({ state: 'connecting', error: Object.assign(new Error('c'), { cause: closedWith(4401) }) })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('an ordinary drop (1006) is not a sign-out', async () => {
    const { onUnauthorized } = await connected()
    sockets[0]?.emit({ state: 'connecting', error: Object.assign(new Error('c'), { cause: closedWith(1006) }) })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('stops listening when the controller is disposed', async () => {
    const { ctrl } = await connected()
    ctrl.dispose()
    expect(sockets[0]?.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
