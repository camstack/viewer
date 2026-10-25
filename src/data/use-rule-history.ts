/**
 * use-rule-history — the three admin reads behind a rule's "last run" and its
 * delivery history, all on the `notificationRules` cap:
 *
 *  - `getRuleLastRuns({})` — every rule's newest delivery, in ONE answer. The
 *    Rules tab asks it once for the whole list ({@link useRuleLastRuns});
 *    never a per-card read.
 *  - `getHistory({ filter: { ruleId, limit: 50 } })` — one rule's deliveries,
 *    newest first. No `since`: the outbox already bounds it.
 *  - `resolveArtifactUrl({ artifactId })` — a fresh signed URL for one
 *    thumbnail, minted when its row is on screen and dropped with it.
 *
 * All three are `auth: 'admin'`. They are asked ONLY once the hub has
 * confirmed the session is an admin (`useAdminVerdict`): a non-admin's
 * FORBIDDEN would otherwise land as a failure on every card, and a pending
 * verdict must not guess.
 *
 * The calls ride {@link capQuery} with `rethrow`, so a failed or unanswered
 * read is an ERROR (D315) and never an empty answer; a hub without the method
 * answers `null`, which here is a failure to read too — no absence may be
 * claimed from a method that is not there.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { NcHistoryEntrySchema, NcRuleLastRunsSchema } from '@camstack/types/client'
import type { NcHistoryEntry, NcRuleLastRuns } from '@camstack/types'
import { useConnection } from '../connection/ConnectionProvider.js'
import { log } from '../lib/logger.js'
import { BULK_QUERY_DEADLINE_MS, capQuery, isRecord } from './cap-query.js'
import { ncNotConnectedError } from './nc-errors.js'
import { useAdminVerdict, type AdminVerdict } from './use-me.js'
import type { RuleLastRunsRead } from '../components/notifications/rule-last-run.js'

const CAP = 'notificationRules'

/** The page size of a rule's history screen. */
export const RULE_HISTORY_LIMIT = 50

/**
 * How long a minted thumbnail URL is reused while its row stays on screen.
 * It is dropped the moment the row unmounts (`gcTime: 0`): a signed link that
 * worked five minutes ago is not proof it works now.
 */
const ARTIFACT_URL_STALE_MS = 2 * 60_000

const LAST_RUNS_KEY = ['v2', 'nc', 'rule-last-runs'] as const

function historyKey(ruleId: string): readonly unknown[] {
  return ['v2', 'nc', 'rule-history', ruleId]
}

function artifactUrlKey(artifactId: string): readonly unknown[] {
  return ['v2', 'nc', 'artifact-url', artifactId]
}

/** One rule's deliveries, as the screen reads them. */
export interface RuleHistoryPage {
  readonly entries: readonly NcHistoryEntry[]
}

/** A minted thumbnail link; `null` = "no image right now". */
export interface ArtifactUrlAnswer {
  readonly url: string | null
}

/** Pure: the answer of `getRuleLastRuns`, or a throw — never a guessed empty. */
export function parseRuleLastRuns(raw: unknown): NcRuleLastRuns {
  if (raw === null) throw new Error(`${CAP}.getRuleLastRuns is not available on this hub`)
  const parsed = NcRuleLastRunsSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`${CAP}.getRuleLastRuns answered an unreadable shape`)
  return parsed.data
}

/**
 * Pure: the rows of a `getHistory` answer. Parsed PER ROW — one row carrying a
 * kind this build does not know must not cost the operator the whole list —
 * and every dropped row is logged, never silent.
 */
export function parseRuleHistory(raw: unknown, ruleId: string): RuleHistoryPage {
  if (raw === null) throw new Error(`${CAP}.getHistory is not available on this hub`)
  const rows = isRecord(raw) ? raw.entries : undefined
  if (!Array.isArray(rows)) throw new Error(`${CAP}.getHistory answered an unreadable shape`)
  const entries: NcHistoryEntry[] = []
  for (const row of rows) {
    const parsed = NcHistoryEntrySchema.safeParse(row)
    if (parsed.success) entries.push(parsed.data)
  }
  if (entries.length < rows.length) {
    log.warn('nc', 'rule history dropped rows this build cannot read', {
      ruleId,
      dropped: rows.length - entries.length,
      read: rows.length,
    })
  }
  return { entries }
}

/** Pure: a `resolveArtifactUrl` answer. Anything but a string URL is "no image". */
export function parseArtifactUrl(raw: unknown): ArtifactUrlAnswer {
  if (raw === null) throw new Error(`${CAP}.resolveArtifactUrl is not available on this hub`)
  const url = isRecord(raw) ? raw.url : undefined
  return { url: typeof url === 'string' && url.length > 0 ? url : null }
}

/** Cache tuning for one admin read. */
interface AdminCapQueryOptions {
  readonly staleTime?: number
  readonly gcTime?: number
}

/**
 * An admin read, and WHY it may not have been asked. `asked` is the enable
 * gate (a confirmed admin, connected); `verdict` and `connected` are its two
 * halves, kept apart because they mean different things to a screen: only
 * `verdict === 'not-admin'` is a claim about the viewer's role. A reconnect
 * (`connected: false`) or a failed `auth.me` (`verdict: 'unknown'`) is not.
 */
export interface AdminCapRead<T> {
  readonly asked: boolean
  readonly verdict: AdminVerdict
  readonly connected: boolean
  readonly query: UseQueryResult<T>
}

/** The tRPC proxy, read by path (the documented `cap-query.ts` boundary). */
type CapClient = Record<string, unknown>

/** Every call bounded as a page read, and a failure is an ERROR, never `null`. */
const ADMIN_READ_OPTIONS = { deadlineMs: BULK_QUERY_DEADLINE_MS, rethrow: true } as const

/**
 * One admin query on the cap. `fetch` makes the `capQuery` call itself, with
 * the cap and method as LITERALS so `check-cap-query-names` can resolve them.
 */
function useAdminCapQuery<T>(
  key: readonly unknown[],
  fetch: (client: CapClient) => Promise<unknown>,
  parse: (raw: unknown) => T,
  options: AdminCapQueryOptions = {},
): AdminCapRead<T> {
  const { controller, state } = useConnection()
  const verdict = useAdminVerdict()
  const connected = state === 'connected'
  const asked = verdict === 'admin' && connected
  const query = useQuery<T>({
    queryKey: key,
    enabled: asked,
    staleTime: options.staleTime ?? 30_000,
    ...(options.gcTime !== undefined ? { gcTime: options.gcTime } : {}),
    queryFn: async (): Promise<T> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      // The documented tRPC boundary (`cap-query.ts`): the proxy is read by
      // path, and the answer is validated right here by `parse`.
      const raw: unknown = await fetch(system.trpcClient as unknown as CapClient)
      return parse(raw)
    },
  })
  return { asked, verdict, connected, query }
}

/**
 * Every rule's last run, for the WHOLE list — call it once, in the list.
 * `hidden` for a viewer the hub has not confirmed as an admin. For a confirmed
 * admin a dropped connection changes nothing that was answered: the cached
 * answer keeps showing (no line blinks on a reconnect), and with no answer yet
 * the line waits, blank.
 */
export function useRuleLastRuns(): RuleLastRunsRead {
  const { verdict, query } = useAdminCapQuery(
    LAST_RUNS_KEY,
    (client) => capQuery(client, 'notificationRules', 'getRuleLastRuns', {}, ADMIN_READ_OPTIONS),
    parseRuleLastRuns,
  )
  if (verdict !== 'admin') return { state: 'hidden' }
  if (query.data !== undefined) return { state: 'answered', data: query.data }
  if (query.isError) return { state: 'failed' }
  return { state: 'pending' }
}

/** One rule's deliveries. Not asked for a non-admin (`asked: false`). */
export function useRuleHistory(ruleId: string): AdminCapRead<RuleHistoryPage> {
  return useAdminCapQuery(
    historyKey(ruleId),
    (client) =>
      capQuery(
        client,
        'notificationRules',
        'getHistory',
        { filter: { ruleId, limit: RULE_HISTORY_LIMIT } },
        ADMIN_READ_OPTIONS,
      ),
    (raw) => parseRuleHistory(raw, ruleId),
  )
}

/** A thumbnail URL, minted while the row that shows it is mounted. */
export function useArtifactUrl(artifactId: string): UseQueryResult<ArtifactUrlAnswer> {
  return useAdminCapQuery(
    artifactUrlKey(artifactId),
    (client) => capQuery(client, 'notificationRules', 'resolveArtifactUrl', { artifactId }, ADMIN_READ_OPTIONS),
    parseArtifactUrl,
    { staleTime: ARTIFACT_URL_STALE_MS, gcTime: 0 },
  ).query
}
