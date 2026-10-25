/**
 * Recording data hooks — timeline coverage + authoritative recorder mode.
 *
 * Cap calls go through the tRPC client structurally (like use-children-states):
 * the viewer's `@camstack/sdk` types may not yet carry the `recording` cap
 * (added on the backend branch `feat/recording-modes-and-videoclips`), so we
 * access it defensively and validate the shape, rather than depend on a types
 * regen. Both hooks degrade to a safe empty/off value when not connected.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { availabilityToCoverage, type AvailabilitySpan } from '../recording/recording-availability.js'
import type { TimeRange } from '../timeline/coverage.js'
import { log } from '../lib/logger.js'
import { capQuery, isRecord } from './cap-query.js'
import { parseScopeRowHeads, isReadRow } from './scope-rows.js'
import { RECORDING_SOURCE_CAMSTACK_ADDON } from './recording-sources.js'
import {
  answerRows,
  fetchAvailabilityRows,
  recordingPlanKey,
  useRecordingProviderPlan,
  type RecordingProviderPlan,
} from './use-recording-provider-plan.js'
import { scopeQueryKey, unionDaySets } from '../components/camera/theater/timeline-scope.js'
import {
  planScopeAsk,
  resolveScopeKnowledge,
  scopeToIds,
  type ScopeAsk,
  type ScopeVerdict,
  type TimelineScope,
} from '../components/camera/theater/timeline-scope-read.js'

export type RecordingMode = 'off' | 'events' | 'continuous'

/** A stable one-element id list, so a per-camera plan does not re-plan on a
 *  fresh array literal every render. */
const SINGLE_IDS = new Map<number, readonly number[]>()
function singleId(deviceId: number): readonly number[] {
  const known = SINGLE_IDS.get(deviceId)
  if (known !== undefined) return known
  const made: readonly number[] = Object.freeze([deviceId])
  SINGLE_IDS.set(deviceId, made)
  return made
}

/**
 * A recording read over a SET of cameras: what it found, and which cameras it
 * cannot speak for.
 *
 * `unknownIds` is not decoration. The union below is drawn as the timeline's
 * coverage, and a camera that could not be read contributes nothing to it —
 * exactly like a camera that recorded nothing. The two must never look the
 * same, which they do the moment the surface only receives the ranges.
 */
export interface ScopeCoverage {
  /** Merged "has footage" coverage across every camera that ANSWERED. */
  readonly ranges: readonly TimeRange[]
  /** Cameras this read cannot speak for (unreadable, or over the ceiling). */
  readonly unknownIds: readonly number[]
  /** The subset that was never asked because the scope exceeded the ceiling. */
  readonly overflowIds: readonly number[]
  readonly verdict: ScopeVerdict
}

const EMPTY_COVERAGE: ScopeCoverage = {
  ranges: [],
  unknownIds: [],
  overflowIds: [],
  verdict: 'complete',
}

const EMPTY_DAY_SET: ReadonlySet<number> = new Set<number>()

/** Day dots over a SET of cameras, with the same honesty about who answered. */
export interface ScopeDays {
  /** Union of local-midnight epochs across every camera that ANSWERED. */
  readonly days: ReadonlySet<number>
  readonly unknownIds: readonly number[]
  readonly overflowIds: readonly number[]
  readonly verdict: ScopeVerdict
}

const EMPTY_DAYS: ScopeDays = {
  days: EMPTY_DAY_SET,
  unknownIds: [],
  overflowIds: [],
  verdict: 'complete',
}

function toSpans(raw: unknown): AvailabilitySpan[] {
  if (!isRecord(raw) || !Array.isArray(raw.ranges)) return []
  const spans: AvailabilitySpan[] = []
  for (const r of raw.ranges) {
    if (!isRecord(r)) continue
    if (typeof r.startMs === 'number' && typeof r.endMs === 'number') {
      spans.push({ profile: typeof r.profile === 'string' ? r.profile : 'unknown', startMs: r.startMs, endMs: r.endMs })
    }
  }
  return spans
}

/**
 * Merged "has footage" coverage for [fromMs,toMs] over the whole scope.
 *
 * ONE call, whatever the scope holds. A single camera still sends the singular
 * `getAvailability` under the key it always had — the cache entry camera-detail
 * has been filling since before the scope existed, and the wire a hub too old
 * for the batch still answers. Two or more send `getAvailabilityBatch`, which
 * is the ONLY shape that can tell an unreadable camera from a quiet one, and
 * therefore the only shape a fused coverage bar may be built from.
 */
export function useRecordingAvailability(
  scope: TimelineScope,
  fromMs: number,
  toMs: number,
  enabled: boolean,
): UseQueryResult<ScopeCoverage> {
  const { controller, state } = useConnection()
  const ask = planScopeAsk(scopeToIds(scope))
  const plan = useRecordingProviderPlan(ask.asked)
  return useQuery<ScopeCoverage>({
    // The plan is in the key: re-pointing one camera at its card changes which
    // calls are made, and the previous answer describes a different source.
    queryKey: [
      'v2',
      'recording',
      'availability',
      scopeQueryKey(ask.asked),
      recordingPlanKey(plan),
      fromMs,
      toMs,
    ],
    // `plan.ready` gates the whole read: an unhydrated prefs store says "no
    // pick" for every camera, and no pick MEANS ours.
    enabled: enabled && state === 'connected' && ask.asked.length > 0 && plan.ready,
    staleTime: 30_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) {
        log.warn('rec:avail', 'no system (not connected)')
        return EMPTY_COVERAGE
      }
      return fetchScopeAvailability(
        system.trpcClient as unknown as Record<string, unknown>,
        ask,
        plan,
        fromMs,
        toMs,
      )
    },
  })
}

/**
 * One recording read, PARTITIONED across the sources the scope is set to.
 *
 * The calls themselves live in `use-recording-provider-plan.ts` — ONE
 * definition of "ask every camera at its own source", shared with the fused
 * activity read. What is here is the reduction to a coverage bar.
 *
 * Every row is gated on its OWN `read`, singular answers included: an
 * `unreadable` answer carries an empty `ranges` that means nothing, and the
 * single-camera path used to report `verdict: 'complete'` regardless — drawing
 * a failed read as a day with no footage.
 */
async function fetchScopeAvailability(
  client: Record<string, unknown>,
  ask: ScopeAsk,
  plan: RecordingProviderPlan,
  fromMs: number,
  toMs: number,
): Promise<ScopeCoverage> {
  const rows = await fetchAvailabilityRows(client, plan, fromMs, toMs)
  const spans: AvailabilitySpan[] = []
  for (const row of rows) {
    if (!isReadRow(row)) continue
    spans.push(...toSpans(row))
  }
  const knowledge = resolveScopeKnowledge({ ask, rows: parseScopeRowHeads(rows) })
  const coverage = availabilityToCoverage(spans)
  log.info('rec:avail', 'scope availability', {
    asked: ask.asked.length,
    ours: plan.ours.length,
    pinned: plan.pinned.length,
    unresolved: plan.unresolved.length,
    read: knowledge.readIds.length,
    unknown: knowledge.unknownIds.length,
    coverage: coverage.length,
  })
  return {
    ranges: coverage,
    unknownIds: knowledge.unknownIds,
    overflowIds: knowledge.overflowIds,
    verdict: knowledge.verdict,
  }
}

/** Local-midnight epochs of days WITH footage in [monthFromMs, monthToMs) —
 *  the UNION over the scope; empty when none / not connected / method absent.
 *  Drives the date-picker dots, and reports which cameras it could not ask. */
export function useDaysWithRecordings(
  scope: TimelineScope,
  monthFromMs: number,
  monthToMs: number,
  enabled: boolean,
): UseQueryResult<ScopeDays> {
  const { controller, state } = useConnection()
  const tzOffsetMinutes = -new Date().getTimezoneOffset()
  const ask = planScopeAsk(scopeToIds(scope))
  const plan = useRecordingProviderPlan(ask.asked)
  return useQuery<ScopeDays>({
    queryKey: [
      'v2',
      'recording',
      'days',
      scopeQueryKey(ask.asked),
      recordingPlanKey(plan),
      monthFromMs,
    ],
    enabled: enabled && state === 'connected' && ask.asked.length > 0 && plan.ready,
    staleTime: 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return EMPTY_DAYS
      return fetchScopeDays(
        system.trpcClient as unknown as Record<string, unknown>,
        ask,
        plan,
        monthFromMs,
        monthToMs,
        tzOffsetMinutes,
      )
    },
  })
}

/** The `days` array off one row of either answer shape. */
function toDays(raw: unknown): readonly number[] {
  if (!isRecord(raw) || !Array.isArray(raw.days)) return []
  return raw.days.filter((d): d is number => typeof d === 'number')
}

/**
 * The multi-camera half of {@link useDaysWithRecordings}.
 *
 * A dot is the operator's whole answer to "which day do I look at", so its
 * absence is a claim — and with N cameras behind one call the claim is only
 * sound for the rows that said `read`. An `unreadable` camera's empty `days`
 * is dropped rather than unioned, and named instead, so the calendar can say
 * "this month is incomplete" rather than draw a month that looks empty.
 */
/**
 * The day dots, PARTITIONED across sources exactly as
 * {@link fetchScopeAvailability} partitions the coverage bar.
 *
 * `rethrow` for the reason the singular call always carried it: a dot on a day
 * IS the answer to "which day do I look at", so a missing dot is a claim that
 * nothing was recorded. Swallowed to `null` the failure became a SUCCESS
 * holding an empty Set — cached, un-retried, drawn as a month with no footage.
 */
async function fetchScopeDays(
  client: Record<string, unknown>,
  ask: ScopeAsk,
  plan: RecordingProviderPlan,
  fromMs: number,
  toMs: number,
  tzOffsetMinutes: number,
): Promise<ScopeDays> {
  const calls: Promise<unknown>[] = []
  if (plan.ours.length > 1) {
    calls.push(
      capQuery(
        client,
        'recordingArchive',
        'getDaysWithRecordingsBatch',
        { deviceIds: plan.ours, fromMs, toMs, tzOffsetMinutes },
        { rethrow: true },
      ),
    )
  } else if (plan.ours.length === 1) {
    calls.push(
      capQuery(
        client,
        'recording',
        'getDaysWithRecordings',
        {
          deviceId: plan.ours[0],
          provider: RECORDING_SOURCE_CAMSTACK_ADDON,
          fromMs,
          toMs,
          tzOffsetMinutes,
        },
        { rethrow: true },
      ),
    )
  }
  for (const pin of plan.pinned) {
    calls.push(
      capQuery(
        client,
        'recording',
        'getDaysWithRecordings',
        { deviceId: pin.deviceId, provider: pin.provider, fromMs, toMs, tzOffsetMinutes },
        { rethrow: true },
      ),
    )
  }

  const answers = await Promise.all(calls)
  const rows: unknown[] = []
  for (const answer of answers) rows.push(...answerRows(answer))
  for (const deviceId of plan.unresolved) rows.push({ deviceId, read: 'unreadable' })

  const perCamera: Set<number>[] = []
  for (const row of rows) {
    if (!isReadRow(row)) continue
    perCamera.push(new Set(toDays(row)))
  }
  const knowledge = resolveScopeKnowledge({ ask, rows: parseScopeRowHeads(rows) })
  return {
    days: unionDaySets(perCamera),
    unknownIds: knowledge.unknownIds,
    overflowIds: knowledge.overflowIds,
    verdict: knowledge.verdict,
  }
}

/** Distinct recorded profiles for a device over [fromMs,toMs] (from the
 *  per-profile `getAvailability` spans). Drives the export profile picker; empty
 *  when none / not connected. */
export function useRecordingProfiles(
  deviceId: number,
  fromMs: number,
  toMs: number,
  enabled: boolean,
): UseQueryResult<string[]> {
  const { controller, state } = useConnection()
  // One camera, but the SAME plan the timeline uses: the profiles offered for
  // export are the ones the source being LOOKED at holds, and asking ours
  // about a camera pointed at its card offers profiles that cannot be
  // exported from there.
  const plan = useRecordingProviderPlan(singleId(deviceId))
  const provider =
    plan.pinned[0]?.provider ??
    (plan.ours.length === 1 ? RECORDING_SOURCE_CAMSTACK_ADDON : null)
  return useQuery<string[]>({
    queryKey: ['v2', 'recording', 'profiles', deviceId, recordingPlanKey(plan), fromMs, toMs],
    enabled: enabled && state === 'connected' && provider !== null,
    staleTime: 30_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system || provider === null) return []
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'recording',
        'getAvailability',
        { deviceId, provider, fromMs, toMs },
      )
      const spans = toSpans(raw)
      const seen = new Set<string>()
      for (const s of spans) if (s.profile && s.profile !== 'unknown') seen.add(s.profile)
      return [...seen]
    },
  })
}

/** Authoritative recorder mode (never inferred from rules). */
export function useRecordingMode(
  deviceId: number,
  enabled: boolean,
): UseQueryResult<RecordingMode | null> {
  const { controller, state } = useConnection()
  return useQuery<RecordingMode | null>({
    queryKey: ['v2', 'recording', 'mode', deviceId],
    enabled: enabled && state === 'connected',
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      // Not connected is not an answer about this camera.
      if (!system) return null
      // `rethrow`, for the same reason `useRecordingAvailability` above does it:
      // a mode that could not be READ used to come back here as `null` and get
      // mapped to `'off'`, and the status dot then drew a continuously
      // recording camera GREEN. Measured on a non-admin session 2026-09-21,
      // and it healed on an app restart — which is what proved it was a failed
      // read rather than a camera that was not recording (D590).
      //
      // A genuinely ABSENT recording cap still resolves to `null` here, which
      // is an honest "this camera has no recorder" and renders the same as
      // unknown rather than as off.
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'recordingArchive',
        'getDeviceConfig',
        { deviceId },
        { rethrow: true },
      )
      if (raw === null) return null
      const mode = isRecord(raw) ? raw.mode : undefined
      return mode === 'continuous' || mode === 'events' ? mode : 'off'
    },
  })
}
