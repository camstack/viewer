import { describe, it, expect, vi } from 'vitest'
import {
  resolveChildrenStates,
  ChildrenStatesAbortedError,
  type CapQueryOptions,
} from '../use-children-states.js'

interface FakeCall {
  readonly cap: string
  readonly deviceId: number
  readonly signal: AbortSignal | undefined
}

interface FakeClient {
  readonly client: Record<string, unknown>
  readonly calls: FakeCall[]
  readonly childrenSignals: (AbortSignal | undefined)[]
}

const CHILDREN = [
  { id: 11, name: 'Lamp', type: 'light', features: ['switch', 'motion-trigger'] },
  { id: 12, name: 'Siren', type: 'siren', features: [] },
]

/**
 * A stand-in for the tRPC proxy: records the options object each leaf received
 * so we can assert the signal was threaded, and lets a test abort mid-flight.
 */
function makeClient(onSwitchRead?: () => void): FakeClient {
  const calls: FakeCall[] = []
  const childrenSignals: (AbortSignal | undefined)[] = []
  const status = (cap: string, payload: Record<string, unknown>) => ({
    getStatus: {
      query: async (input: { deviceId: number }, opts?: CapQueryOptions) => {
        calls.push({ cap, deviceId: input.deviceId, signal: opts?.signal })
        if (cap === 'switch') onSwitchRead?.()
        return payload
      },
    },
  })
  const client: Record<string, unknown> = {
    deviceManager: {
      getChildren: {
        query: async (_input: { parentDeviceId: number }, opts?: CapQueryOptions) => {
          childrenSignals.push(opts?.signal)
          return CHILDREN
        },
      },
    },
    switch: status('switch', { on: true }),
    motionTrigger: status('motionTrigger', { enabled: true }),
  }
  return { client, calls, childrenSignals }
}

describe('resolveChildrenStates — happy path (unchanged behaviour)', () => {
  it('returns one entry per controllable child', async () => {
    const { client } = makeClient()
    const out = await resolveChildrenStates(client, 102, undefined)
    expect(out).toEqual([
      { id: 11, name: 'Lamp', kind: 'light', hasSwitch: true, on: true, hasMotion: true, motionOn: true },
      { id: 12, name: 'Siren', kind: 'siren', hasSwitch: true, on: true, hasMotion: false, motionOn: false },
    ])
  })

  it('tolerates a missing signal (the hook can be called without one)', async () => {
    const { client, childrenSignals } = makeClient()
    await resolveChildrenStates(client, 102, undefined)
    expect(childrenSignals).toEqual([undefined])
  })
})

describe('resolveChildrenStates — abort signal', () => {
  it('threads the signal into deviceManager.getChildren', async () => {
    const ac = new AbortController()
    const { client, childrenSignals } = makeClient()
    await resolveChildrenStates(client, 102, ac.signal)
    expect(childrenSignals).toEqual([ac.signal])
  })

  it('threads the signal into every per-child getStatus call', async () => {
    const ac = new AbortController()
    const { client, calls } = makeClient()
    await resolveChildrenStates(client, 102, ac.signal)
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call.signal).toBe(ac.signal)
  })

  it('never dispatches the per-child fan-out when already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const { client, calls } = makeClient()
    await expect(resolveChildrenStates(client, 102, ac.signal)).rejects.toBeInstanceOf(
      ChildrenStatesAbortedError,
    )
    expect(calls).toEqual([])
  })

  it('stops the fan-out mid-flight when the signal aborts during it', async () => {
    const ac = new AbortController()
    // Abort as soon as the FIRST switch read happens. The motion-trigger read
    // for that child has not been issued yet and must never be.
    const { client, calls } = makeClient(() => ac.abort())
    await expect(resolveChildrenStates(client, 102, ac.signal)).rejects.toBeInstanceOf(
      ChildrenStatesAbortedError,
    )
    expect(calls.some((c) => c.cap === 'motionTrigger')).toBe(false)
  })

  it('REJECTS rather than resolving a degraded result — a cancelled fetch is not an answer', async () => {
    const ac = new AbortController()
    // getChildren throws: the defensive catch would normally return EMPTY, which
    // React Query would cache as "this camera has no accessories".
    const client: Record<string, unknown> = {
      deviceManager: {
        getChildren: {
          query: async () => {
            ac.abort()
            throw new Error('socket closed')
          },
        },
      },
    }
    await expect(resolveChildrenStates(client, 102, ac.signal)).rejects.toBeInstanceOf(
      ChildrenStatesAbortedError,
    )
  })

  it('still degrades to EMPTY when getChildren fails for a NON-abort reason', async () => {
    const ac = new AbortController()
    const client: Record<string, unknown> = {
      deviceManager: {
        getChildren: {
          query: async () => {
            throw new Error('NOT_FOUND')
          },
        },
      },
    }
    await expect(resolveChildrenStates(client, 102, ac.signal)).resolves.toEqual([])
  })

  it('does not launder an aborted per-child read into a null status', async () => {
    const ac = new AbortController()
    const seen = vi.fn()
    const client: Record<string, unknown> = {
      deviceManager: {
        getChildren: {
          query: async () => [{ id: 11, name: 'Lamp', type: 'light', features: [] }],
        },
      },
      switch: {
        getStatus: {
          query: async () => {
            seen()
            ac.abort()
            throw new Error('aborted by transport')
          },
        },
      },
    }
    await expect(resolveChildrenStates(client, 102, ac.signal)).rejects.toBeInstanceOf(
      ChildrenStatesAbortedError,
    )
    expect(seen).toHaveBeenCalledTimes(1)
  })
})
