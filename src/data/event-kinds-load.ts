/**
 * Load the event-kind taxonomy for a set of cameras.
 *
 * `listEventKindsBatch` is one call. The per-camera `listEventKinds` path is
 * kept only for a hub that predates the batch (NOT_FOUND / missing procedure).
 * A timeout or any other failure returns `[]` — fanning out after a deadline
 * is how Events became unusable on a saturated hub-main (2026-08-24): each
 * single-camera call composes `getCameraStatus` on the cluster's only queue.
 */

import { BULK_QUERY_DEADLINE_MS, capQuery } from './cap-query.js'
import { isQueryDeadlineError } from './query-deadline.js'
import { log } from '../lib/logger.js'
import {
  mergeEventKinds,
  toEventKindDescriptors,
  type EventKindDescriptor,
} from './event-kinds.js'

const EMPTY: readonly EventKindDescriptor[] = []

function readCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const code: unknown = Reflect.get(value, 'code')
  return typeof code === 'string' ? code : null
}

/** True when the hub has no such procedure — not when it is merely slow. */
export function isMissingProcedureError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const data: unknown = Reflect.get(err, 'data')
  if (readCode(data) === 'NOT_FOUND') return true
  const shape: unknown = Reflect.get(err, 'shape')
  if (
    typeof shape === 'object' &&
    shape !== null &&
    readCode(Reflect.get(shape, 'data')) === 'NOT_FOUND'
  ) {
    return true
  }
  const message: unknown = Reflect.get(err, 'message')
  return typeof message === 'string' && message.includes('No procedure found')
}

function kindsFromBatchRow(row: unknown): unknown {
  if (typeof row === 'object' && row !== null) {
    return Reflect.get(row, 'kinds')
  }
  return undefined
}

async function fanOutPerCamera(
  client: Record<string, unknown>,
  deviceIds: readonly number[],
): Promise<readonly EventKindDescriptor[]> {
  const lists = await Promise.all(
    deviceIds.map(async (deviceId) => {
      const raw = await capQuery(client, 'pipelineAnalytics', 'listEventKinds', { deviceId })
      return toEventKindDescriptors(raw)
    }),
  )
  return mergeEventKinds(lists)
}

export async function loadEventKinds(
  client: Record<string, unknown>,
  deviceIds: readonly number[],
): Promise<readonly EventKindDescriptor[]> {
  const ids = [...new Set(deviceIds)]
  if (ids.length === 0) return EMPTY

  let page: unknown
  try {
    page = await capQuery(client, 'pipelineAnalytics', 'listEventKindsBatch', { deviceIds: ids }, {
      deadlineMs: BULK_QUERY_DEADLINE_MS,
      rethrow: true,
    })
  } catch (err) {
    if (isQueryDeadlineError(err) || !isMissingProcedureError(err)) {
      log.warn('event-kinds', 'batch unavailable — not fanning out per camera', {
        error: String(err),
        cameras: ids.length,
      })
      return EMPTY
    }
    log.warn('event-kinds', 'batch procedure missing — falling back per camera', {
      cameras: ids.length,
    })
    return fanOutPerCamera(client, ids)
  }

  if (page === null) {
    log.warn('event-kinds', 'batch procedure missing — falling back per camera', {
      cameras: ids.length,
    })
    return fanOutPerCamera(client, ids)
  }

  const rows = Array.isArray(page) ? page : []
  return mergeEventKinds(rows.map((row) => toEventKindDescriptors(kindsFromBatchRow(row))))
}
