/**
 * `loadEventKinds` — ONE batch, and the per-camera path only when the hub
 * genuinely does not have the batch procedure.
 *
 * Live hub 2026-08-24 ~19:13: Events was unusable because
 * `listEventKindsBatch` hit the 6 s badge deadline, `capQuery` collapsed that
 * to `null`, and the hook then issued `listEventKinds` once per camera (128
 * client timeouts in ~20 min). Each of those composes `getCameraStatus` +
 * bindings on hub-main, the cluster's only queue ([D181]).
 *
 * A hub too old for the batch answers NOT_FOUND. A hub that is merely busy
 * answers slowly. Those are not the same event, and only the first may fan
 * out. A timeout, a transport error, or an empty batch is `[]` — the taxonomy
 * is static enough that a miss is cheaper than a retry storm.
 */

import { describe, expect, it, vi } from 'vitest'
import { QueryDeadlineError } from '../query-deadline.js'
import { BULK_QUERY_DEADLINE_MS } from '../cap-query.js'
import { loadEventKinds } from '../event-kinds-load.js'

vi.mock('../../lib/logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

interface KindRow {
  readonly kind: string
}

function batchPage(deviceId: number, kinds: readonly KindRow[]): Record<string, unknown> {
  return { deviceId, kinds }
}

function clientWith(handlers: {
  readonly batch?: (input: { deviceIds: readonly number[] }) => Promise<unknown>
  readonly single?: (input: { deviceId: number }) => Promise<unknown>
}): {
  readonly client: Record<string, unknown>
  readonly batchCalls: unknown[]
  readonly singleCalls: unknown[]
} {
  const batchCalls: unknown[] = []
  const singleCalls: unknown[] = []
  return {
    batchCalls,
    singleCalls,
    client: {
      pipelineAnalytics: {
        listEventKindsBatch: {
          query: async (input: { deviceIds: readonly number[] }) => {
            batchCalls.push(input)
            if (handlers.batch === undefined) throw new Error('batch not stubbed')
            return handlers.batch(input)
          },
        },
        listEventKinds: {
          query: async (input: { deviceId: number }) => {
            singleCalls.push(input)
            if (handlers.single === undefined) throw new Error('single not stubbed')
            return handlers.single(input)
          },
        },
      },
    },
  }
}

function notFound(): Error {
  const err = new Error('No procedure found on path "pipelineAnalytics.listEventKindsBatch"')
  Object.assign(err, { data: { code: 'NOT_FOUND' } })
  return err
}

describe('loadEventKinds', () => {
  it('uses the batch and never fans out per camera', async () => {
    const { client, singleCalls } = clientWith({
      batch: async () => [
        batchPage(101, [{ kind: 'person' }]),
        batchPage(102, [{ kind: 'vehicle' }]),
      ],
    })
    const kinds = await loadEventKinds(client, [102, 101, 101])
    expect(kinds.map((k) => k.kind).sort()).toEqual(['person', 'vehicle'])
    expect(singleCalls).toEqual([])
  })

  it('fans out per camera ONLY when the batch procedure is missing', async () => {
    const { client, singleCalls } = clientWith({
      batch: async () => {
        throw notFound()
      },
      single: async ({ deviceId }) => [{ kind: deviceId === 101 ? 'person' : 'car' }],
    })
    const kinds = await loadEventKinds(client, [101, 102])
    expect(kinds.map((k) => k.kind).sort()).toEqual(['car', 'person'])
    expect(singleCalls).toEqual([{ deviceId: 101 }, { deviceId: 102 }])
  })

  it('does not fan out when the batch hits its deadline', async () => {
    const { client, singleCalls } = clientWith({
      batch: async () => {
        throw new QueryDeadlineError('pipelineAnalytics.listEventKindsBatch', 6_000)
      },
      single: async () => [{ kind: 'person' }],
    })
    await expect(loadEventKinds(client, [101, 102, 104])).resolves.toEqual([])
    expect(singleCalls).toEqual([])
  })

  it('does not fan out on a generic batch failure', async () => {
    const { client, singleCalls } = clientWith({
      batch: async () => {
        throw new Error('Unknown error')
      },
      single: async () => [{ kind: 'person' }],
    })
    await expect(loadEventKinds(client, [101])).resolves.toEqual([])
    expect(singleCalls).toEqual([])
  })

  it('asks the batch on the bulk deadline, not the badge one', async () => {
    expect(BULK_QUERY_DEADLINE_MS).toBeGreaterThan(6_000)
  })
})
