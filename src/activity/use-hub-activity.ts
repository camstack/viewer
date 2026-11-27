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
import { hubFromList, hubListWanted, type HubJobItem, type HubJobsSummary } from './hub-jobs-model.js'

export interface HubActivity {
  /** `null` = unknown (not asked, or not answered) — never "no jobs". */
  readonly hub: readonly HubJobItem[] | null
  /** `null` = unknown. */
  readonly summary: HubJobsSummary | null
  /** The list was asked for and the call failed (a hub with no `jobs` capability is not a failure). */
  readonly listFailed: boolean
}

export function useHubActivity(open: boolean): HubActivity {
  const summaryQuery = useHubJobsSummary()
  const summary = summaryQuery.data ?? null
  const wanted = hubListWanted(open, summary)
  const list = useHubJobsList(wanted)
  return { hub: hubFromList(wanted, list.data), summary, listFailed: wanted && list.isError }
}
