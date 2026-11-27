/**
 * Hub jobs data hooks — the viewer side of the `jobs` capability (the hub's
 * ledger of long-running work). The caller sees their own jobs, an admin all of
 * them; the hub enforces that, nothing here filters.
 *
 * An unanswered query is UNKNOWN, never empty: both reads resolve `null` when
 * the hub did not answer (or has no `jobs` capability yet), and callers must
 * not fold that into "no jobs". The list is only fetched while it is wanted
 * (the popover is open, or the summary says something runs); the summary is a
 * cheap read at a modest interval, faster while a job runs.
 */
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import {
  parseHubJobs,
  parseHubSummary,
  type HubJobItem,
  type HubJobsSummary,
} from '../activity/hub-jobs-model.js'
import { capMutate, capQuery, isRecord } from './cap-query.js'

const JOBS_KEY = ['v2', 'hub-jobs'] as const

/** Summary cadence: idle, and while a hub job runs. */
export const HUB_SUMMARY_IDLE_POLL_MS = 30_000
export const HUB_SUMMARY_ACTIVE_POLL_MS = 5_000
/** List cadence while it is wanted. */
export const HUB_LIST_POLL_MS = 4_000
/** Rows the popover asks for. */
const LIST_LIMIT = 50

/** `jobs.getSummary`; `null` = not answered. */
export function useHubJobsSummary(): UseQueryResult<HubJobsSummary | null> {
  const { controller, state } = useConnection()
  return useQuery<HubJobsSummary | null>({
    queryKey: [...JOBS_KEY, 'summary'],
    enabled: state === 'connected',
    staleTime: 5_000,
    refetchInterval: (query) =>
      (query.state.data?.running ?? 0) > 0 ? HUB_SUMMARY_ACTIVE_POLL_MS : HUB_SUMMARY_IDLE_POLL_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      const raw = await capQuery(system.trpcClient as Record<string, unknown>, 'jobs', 'getSummary', {})
      return parseHubSummary(raw)
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
    refetchInterval: HUB_LIST_POLL_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      const raw = await capQuery(system.trpcClient as Record<string, unknown>, 'jobs', 'list', {
        includeDismissed: false,
        limit: LIST_LIMIT,
      })
      return parseHubJobs(raw)
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
      const system = controller.getSystem()
      const raw = system
        ? await capMutate(system.trpcClient as Record<string, unknown>, 'jobs', 'cancel', { jobId })
        : null
      if (!isRecord(raw)) return { accepted: false, reason: null }
      return { accepted: raw.accepted === true, reason: raw.reason }
    },
    onSettled: refresh,
  })
  const dismissMutation = useMutation({
    mutationFn: async (jobId: string): Promise<boolean> => {
      const system = controller.getSystem()
      const raw = system
        ? await capMutate(system.trpcClient as Record<string, unknown>, 'jobs', 'dismiss', { jobId })
        : null
      return isRecord(raw) && raw.dismissed === true
    },
    onSettled: refresh,
  })

  const resultUrl = useCallback(
    async (jobId: string): Promise<string | null> => {
      const system = controller.getSystem()
      if (!system) return null
      const raw = await capQuery(system.trpcClient as Record<string, unknown>, 'jobs', 'collect', { jobId })
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
