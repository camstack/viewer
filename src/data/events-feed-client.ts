/**
 * events-feed-client — the app's binding of the shared feed hook's one call
 * (`listRecentTracks`) onto the hub's tRPC client.
 *
 * Failures PROPAGATE (`rethrow`): the shared hook owns the retry/backoff and
 * the error state, and it can only do that if a dead page is an exception. A
 * `null` here would read as "no such cap" and be painted as an unexpected
 * response instead of a retry.
 *
 * Bounded by the bulk deadline, because a page of history is the heaviest read
 * on this screen and a node that never answers must end in an error state, not
 * a spinner that never stops.
 */
import type { EventsFeedClient } from '../../shared/events/events-client.js'
import { BULK_QUERY_DEADLINE_MS, capQuery } from './cap-query.js'
import { log } from '../lib/logger.js'
import type { EventsFeedLog } from '../../shared/events/use-events-feed.js'

/** Resolved per CALL: the system behind the controller is replaced on a route
 *  failover, and a client bound at construction would keep asking the old one. */
export type TrpcClientSource = () => object | null

export function createEventsFeedClient(source: TrpcClientSource): EventsFeedClient {
  return {
    listRecentTracks: (input) => {
      const trpcClient = source()
      if (trpcClient === null) return Promise.reject(new Error('not connected'))
      return capQuery(
        // The tRPC v11 client is a callable proxy; `capQuery` reads it by
        // name, which is why this one documented boundary exists (see its
        // header) and every data hook crosses it the same way.
        trpcClient as Record<string, unknown>,
        'pipelineAnalytics',
        'listRecentTracks',
        input,
        { deadlineMs: BULK_QUERY_DEADLINE_MS, rethrow: true },
      )
    },
  }
}

/** The feed's diagnostics, on the same `events:feed` scope the embed's host
 *  forwarded them to — so a report filed before and after this change reads
 *  the same. A routine page is `debug`; a failure, retry or hole is `warn`. */
export const logEventsFeed: EventsFeedLog = (message, data) => {
  const routine = message === 'request complete'
  if (routine) log.debug('events:feed', message, data)
  else log.warn('events:feed', message, data)
}
