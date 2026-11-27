/**
 * use-hub-activity — what the hub says about the jobs this user may see, for
 * the Activity button and popover.
 *
 * The summary is always read (cheap, modest interval). The full list is read
 * only while it is wanted — the popover is open, or the summary says a hub job
 * runs — so an idle app never polls it. Outside those moments the list is
 * treated as not known, whatever an earlier fetch left in the cache: a stale
 * "running" must not outlive the poll that would have corrected it.
 */
import { useHubJobsList, useHubJobsSummary } from '../data/use-hub-jobs.js'
import type { HubJobItem, HubJobsSummary } from './hub-jobs-model.js'

export interface HubActivity {
  /** `null` = unknown (not asked, or not answered) — never "no jobs". */
  readonly hub: readonly HubJobItem[] | null
  /** `null` = unknown. */
  readonly summary: HubJobsSummary | null
  /** The list was asked for and did not answer. */
  readonly listFailed: boolean
}

export function useHubActivity(open: boolean): HubActivity {
  const summaryQuery = useHubJobsSummary()
  const summary = summaryQuery.data ?? null
  const wanted = open || (summary?.running ?? 0) > 0
  const list = useHubJobsList(wanted)
  const hub = wanted ? (list.data ?? null) : null
  return { hub, summary, listFailed: wanted && !list.isLoading && hub === null }
}
