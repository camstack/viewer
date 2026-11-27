/**
 * Hub jobs data hooks — the viewer side of the `jobs` capability (the hub's
 * ledger of long-running work). The caller sees their own jobs, an admin all of
 * them; the hub enforces that, nothing here filters.
 *
 * An unanswered query is UNKNOWN, never empty. Both reads call with `rethrow`:
 * a hub that has no `jobs` capability answers `null` (a real answer — polling
 * stops there), a failed or timed-out call throws (the query errors and is
 * retried at its cadence). Callers never fold either into "no jobs". The list
 * is only fetched while it is wanted
 * (the popover is open, or the summary says something runs); the summary is a
 * cheap read at a modest interval, faster while a job runs.
 */
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import {
  listPollMs,
  parseHubJobs,
  parseHubSummary,
  summaryPollMs,
  type HubJobItem,
  type HubJobsSummary,
} from '../activity/hub-jobs-model.js'
import { capMutate, capQuery, isCapClient, isRecord } from './cap-query.js'

const JOBS_KEY = ['v2', 'hub-jobs'] as const

/** Rows the popover asks for. */
const LIST_LIMIT = 50

/** `jobs.getSummary`; `null` = not answered. */
export function useHubJobsSummary(): UseQueryResult<HubJobsSummary | null> {
  const { controller, state } = useConnection()
  return useQuery<HubJobsSummary | null>({
    queryKey: [...JOBS_KEY, 'summary'],
    enabled: state === 'connected',
    staleTime: 5_000,
    // `null` = this hub has no `jobs` capability: nothing to poll for.
    refetchInterval: (query) => summaryPollMs(query.state.data),
    queryFn: async () => {
      const client = controller.getSystem()?.trpcClient
      if (!isCapClient(client)) return null
      const raw = await capQuery(client, 'jobs', 'getSummary', {}, { rethrow: true })
      if (raw === null) return null
      const summary = parseHubSummary(raw)
      if (summary === null) throw new Error('jobs.getSummary answered an unreadable summary')
      return summary
    },
  })
}

/**
 * `jobs.list` (dismissed ones excluded); data `null` = not answered. Fetched
 * only while `wanted`, and polled while it is.
 */
export function useHubJobsList(wanted: boolean): UseQueryResult<readonly HubJobItem[] | null> {
  const { controller, state } = useConnection()
  return useQuery<readonly HubJobItem[] | null>({
    queryKey: [...JOBS_KEY, 'list'],
    enabled: state === 'connected' && wanted,
    staleTime: 2_000,
    refetchInterval: (query) => listPollMs(query.state.data),
    queryFn: async () => {
      const client = controller.getSystem()?.trpcClient
      if (!isCapClient(client)) return null
      const raw = await capQuery(
        client,
        'jobs',
        'list',
        { includeDismissed: false, limit: LIST_LIMIT },
        { rethrow: true },
      )
      if (raw === null) return null
      const jobs = parseHubJobs(raw)
      if (jobs === null) throw new Error('jobs.list answered an unreadable list')
      return jobs
    },
  })
}

export interface CancelAnswer {
  readonly accepted: boolean
  /** Why it was refused; `null` for an accepted cancel or an unreadable answer. */
  readonly reason: unknown
}

export interface HubJobActions {
  /** Asks the producer to stop; the state changes only when it says so. */
  readonly cancel: (jobId: string) => Promise<CancelAnswer>
  /** Hides a finished job from this user's list. */
  readonly dismiss: (jobId: string) => Promise<boolean>
  /** Where the finished job's output is, as an absolute URL; `null` = none or not answered. */
  readonly resultUrl: (jobId: string) => Promise<string | null>
}

export function useHubJobActions(): HubJobActions {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: JOBS_KEY })
  }, [queryClient])

  const cancelMutation = useMutation({
    mutationFn: async (jobId: string): Promise<CancelAnswer> => {
      const client = controller.getSystem()?.trpcClient
      const raw = isCapClient(client) ? await capMutate(client, 'jobs', 'cancel', { jobId }) : null
      if (!isRecord(raw)) return { accepted: false, reason: null }
      return { accepted: raw.accepted === true, reason: raw.reason }
    },
    onSettled: refresh,
  })
  const dismissMutation = useMutation({
    mutationFn: async (jobId: string): Promise<boolean> => {
      const client = controller.getSystem()?.trpcClient
      const raw = isCapClient(client) ? await capMutate(client, 'jobs', 'dismiss', { jobId }) : null
      return isRecord(raw) && raw.dismissed === true
    },
    onSettled: refresh,
  })

  const resultUrl = useCallback(
    async (jobId: string): Promise<string | null> => {
      const system = controller.getSystem()
      const client = system?.trpcClient
      if (!system || !isCapClient(client)) return null
      const raw = await capQuery(client, 'jobs', 'collect', { jobId })
      if (!isRecord(raw) || typeof raw.href !== 'string' || raw.href.length === 0) return null
      const href = raw.href
      if (href.startsWith('http://') || href.startsWith('https://')) return href
      const base = system.serverUrl.replace(/\/$/, '')
      return href.startsWith('/') ? `${base}${href}` : `${base}/${href}`
    },
    [controller],
  )

  return {
    cancel: cancelMutation.mutateAsync,
    dismiss: dismissMutation.mutateAsync,
    resultUrl,
  }
}
