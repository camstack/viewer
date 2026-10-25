/**
 * useTimelineActivity — fetch recording availability, motion density, and audio
 * events in parallel for the theater timeline activity bars.
 *
 * One React Query whose queryFn issues three parallel cap/recording calls and
 * maps the results through the pure M4 helpers. Returns safe empty fallback on
 * error or when not connected.
 */

import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { log } from '../lib/logger.js'
import { capQuery, isRecord } from './cap-query.js'
import { parseScopeRowHeads, scopeRowsOf, isReadRow } from './scope-rows.js'
import {
  fetchAvailabilityRows,
  recordingPlanKey,
  useRecordingProviderPlan,
} from './use-recording-provider-plan.js'
import { scopeQueryKey } from '../components/camera/theater/timeline-scope.js'
import {
  planScopeAsk,
  resolveScopeKnowledge,
  scopeToIds,
  type ScopeAsk,
  type ScopeKnowledge,
  type ScopeVerdict,
  type TimelineScope,
} from '../components/camera/theater/timeline-scope-read.js'
import {
  densityToMotionBuckets,
  densityToAudioBuckets,
  mergeDensityRows,
  parseDensityRows,
  pickBucketMs,
  type DensityRow,
  type Range,
  type Bucket,
} from '../components/camera/theater/activity-bars.js'

// ─── Return type ──────────────────────────────────────────────────────

export interface TimelineActivity {
  readonly recording: readonly Range[]
  readonly motion: readonly Bucket[]
  readonly audio: readonly Bucket[]
  /**
   * Cameras in scope this bundle cannot speak for — an `unreadable` row, or an
   * id over the batch ceiling.
   *
   * It rides INSIDE the activity model rather than beside it because the three
   * arrays above are a UNION: a camera missing from the union subtracts from
   * every lane at once, silently, and there is no other field that could ever
   * carry "and these lanes are incomplete". Empty on the single-camera path,
   * where a failed read is already a rejection and the fault slot owns it.
   */
  readonly unknownIds: readonly number[]
  readonly overflowIds: readonly number[]
  readonly verdict: ScopeVerdict
}

const EMPTY_ACTIVITY: TimelineActivity = {
  recording: [],
  motion: [],
  audio: [],
  unknownIds: [],
  overflowIds: [],
  verdict: 'complete',
}

/**
 * The activity model AND the health of the read that produced it.
 *
 * The status is not decoration. Clips mode derives its cards from this
 * query's `recording` ranges, so an availability read that has not landed yet
 * looks exactly like a camera that recorded nothing — the clip surface said
 * "no clips for this camera" and then filled with cards a moment later. And an
 * availability read that FAILED is a fault the theater's one fault slot has to
 * hear about (`timeline-faults.ts` already claims, in prose, that it does).
 *
 * `activity` keeps the identity React Query hands back, so the memos that read
 * it do not re-run because a status flag moved.
 */
export interface TimelineActivityResult {
  readonly activity: TimelineActivity
  /**
   * A FIRST read is in flight — nothing to draw yet.
   *
   * Not `isFetching`: the live window refetches on its own, and a quiet camera
   * must not flicker between "no clips" and "loading" every time it does.
   */
  readonly loading: boolean
  /** The last read rejected. */
  readonly failed: boolean
  /** An attempt is in flight right now — the retry phase of the fault notice. */
  readonly fetching: boolean
  /** Retry now (the fault notice's retry, for the recordings source). */
  readonly refetch: () => void
}

// ─── Shape validators ─────────────────────────────────────────────────

function toRanges(raw: unknown): Range[] {
  if (!isRecord(raw) || !Array.isArray(raw.ranges)) return []
  const parsed: Range[] = []
  for (const r of raw.ranges) {
    if (!isRecord(r)) continue
    if (typeof r.startMs === 'number' && typeof r.endMs === 'number' && r.endMs > r.startMs) {
      parsed.push({ startMs: r.startMs, endMs: r.endMs })
    }
  }
  // getAvailability returns one range set PER PROFILE, so the same wall-clock
  // spans repeat. Merge overlapping/adjacent ranges into a single coverage union
  // — clean recording bar + no duplicate React keys on the recording lane.
  parsed.sort((a, b) => a.startMs - b.startMs)
  const merged: Range[] = []
  for (const r of parsed) {
    const last = merged[merged.length - 1]
    if (last !== undefined && r.startMs <= last.endMs) {
      if (r.endMs > last.endMs) merged[merged.length - 1] = { startMs: last.startMs, endMs: r.endMs }
    } else {
      merged.push({ startMs: r.startMs, endMs: r.endMs })
    }
  }
  return merged
}

/**
 * Fuse the density histograms of every camera that ANSWERED into one.
 *
 * Summed BEFORE normalisation (`mergeDensityRows`), so the tape is one density
 * rather than N independently-scaled charts glued together — a quiet camera's
 * peak must not paint as tall as a busy one's. An `unreadable` row is skipped
 * rather than contributing its empty histogram: adding zeros would lower
 * nothing, but it would let the surface believe it had that camera's answer.
 */
function fuseDensityRows(raw: unknown): readonly DensityRow[] {
  const groups: DensityRow[][] = []
  for (const row of scopeRowsOf(raw)) {
    if (!isReadRow(row)) continue
    groups.push(parseDensityRows(isRecord(row) ? row.buckets : null))
  }
  return mergeDensityRows(groups)
}

/** The coverage union over every camera that answered. Same skip rule. */
function fuseRanges(raw: unknown): readonly Range[] {
  const merged: Range[] = []
  for (const row of scopeRowsOf(raw)) {
    if (!isReadRow(row)) continue
    merged.push(...toRanges(row))
  }
  return mergeSortedRanges(merged)
}

/** Overlapping/adjacent spans from different cameras collapse into one band —
 *  the same union {@link toRanges} performs per camera, applied across them. */
function mergeSortedRanges(ranges: readonly Range[]): readonly Range[] {
  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last !== undefined && r.startMs <= last.endMs) {
      if (r.endMs > last.endMs) out[out.length - 1] = { startMs: last.startMs, endMs: r.endMs }
    } else {
      out.push(r)
    }
  }
  return out
}

/**
 * A camera is known to this bundle only when BOTH halves could read it.
 *
 * The lanes are drawn from one model — density feeds motion and audio,
 * availability feeds the recording band — so a camera whose density answered
 * and whose footage did not is still a camera the bundle cannot speak for. The
 * strict reading is the only one that cannot promise a lane it does not have.
 */
function mergeKnowledge(ask: ScopeAsk, rawDensity: unknown, rawAvailability: unknown): ScopeKnowledge {
  const density = resolveScopeKnowledge({ ask, rows: parseScopeRowHeads(rawDensity) })
  const availability = resolveScopeKnowledge({ ask, rows: parseScopeRowHeads(rawAvailability) })
  const bothRead = new Set(density.readIds.filter((id) => availability.readIds.includes(id)))
  const readIds = ask.asked.filter((id) => bothRead.has(id))
  const unknownIds = [...ask.asked.filter((id) => !bothRead.has(id)), ...ask.overflow]
  return {
    readIds,
    unknownIds,
    overflowIds: [...ask.overflow],
    verdict: unknownIds.length === 0 ? 'complete' : readIds.length === 0 ? 'none' : 'partial',
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────

/**
 * Fetch recording coverage, motion density, and audio events for `deviceId`
 * in the window `[fromMs, toMs)` and map them to display-ready arrays.
 *
 * All three are fetched in parallel inside a single React Query. Returns
 * `{ recording: [], motion: [], audio: [] }` on error or when not connected.
 */
export function useTimelineActivity(
  scope: TimelineScope,
  fromMs: number,
  toMs: number,
  /**
   * Hold the query until the caller says the screen is ready.
   *
   * These are the two heaviest fetches on the camera screen — up to 500 rows
   * plus the density+availability activity bundle — and they used to race the WebRTC
   * negotiation on the SAME socket, so the timeline's data competed with the
   * seconds that decide how fast the picture appears. Defaults to true so no
   * other caller changes behaviour.
   */
  ready = true,
): TimelineActivityResult {
  const { controller, state } = useConnection()
  const ask = planScopeAsk(scopeToIds(scope))

  // Same reasoning as `useDeviceTracks`: recording ranges and motion/audio
  // buckets for a window that already ended cannot change.
  const plan = useRecordingProviderPlan(ask.asked)
  const isImmutablePast = toMs < Date.now() - 120_000
  const query = useQuery<TimelineActivity>({
    queryKey: [
      'v2',
      'analytics',
      'activity',
      scopeQueryKey(ask.asked),
      recordingPlanKey(plan),
      fromMs,
      toMs,
    ],
    // KEEP the previous window's rows while a wider one loads.
    //
    // `fromMs` changes whenever the timeline extends its lookback — which a
    // scrub toward older clusters does routinely — and without this the query
    // collapses to `undefined` for the round trip. Every cluster card unmounts
    // and remounts, which is the "continuous loading that blocks everything"
    // the operator reported: not a slow fetch, a wipe. The old rows are a
    // strict subset of the new window, so showing them while it loads is
    // correct, not merely convenient.
    placeholderData: (previous) => previous,
    enabled: ready && state === 'connected' && ask.asked.length > 0 && plan.ready,
    staleTime: isImmutablePast ? Number.POSITIVE_INFINITY : 30_000,
    queryFn: async (): Promise<TimelineActivity> => {
      const system = controller.getSystem()
      if (!system) {
        log.warn('timeline-activity', 'no system (not connected)')
        return EMPTY_ACTIVITY
      }

      const client = system.trpcClient as Record<string, unknown>
      const bucketMs = pickBucketMs(fromMs, toMs)
      const multi = ask.asked.length > 1

      // TWO calls, whatever the scope holds — never two PER CAMERA. The batch
      // pair carries a per-camera `read` tag the singular pair has no room for,
      // which is why the multi-camera answer can name the cameras it is missing
      // and the single-camera one does not have to.
      const [rawDensity, rawAvailability] = await Promise.all([
        multi
          ? capQuery(client, 'pipelineAnalytics', 'getEventDensityBatch', {
              deviceIds: ask.asked,
              since: fromMs,
              until: toMs,
              bucketMs,
            })
          : capQuery(client, 'pipelineAnalytics', 'getEventDensity', {
              deviceId: ask.asked[0],
              since: fromMs,
              until: toMs,
              bucketMs,
            }),
        // `rethrow`: a footage read that FAILED may not come back as `null`.
        //
        // Swallowed, it produced `recording: []`, which draws as "this camera
        // recorded nothing today" — the wrong thing to tell an operator whose
        // hub simply did not answer (D315, D393, D590). Rejecting takes the
        // motion and audio lanes down with it, and that is the DESIGN, not a
        // regression: `mergeKnowledge` already rules that a camera whose
        // density answered and whose footage did not is a camera this bundle
        // cannot speak for. The fault slot owns the rejection and says so.
        // Partitioned by SOURCE, not by scope size: every camera is asked at
        // the source the operator selected for it, and the answer always
        // arrives as ROWS carrying their own `read` — so the single-camera
        // case is no longer assumed complete. It used to be
        // (`COMPLETE_KNOWLEDGE`), which meant one camera whose footage read
        // FAILED drew an empty recording lane and claimed it was the truth.
        fetchAvailabilityRows(client, plan, fromMs, toMs),
      ])

      const densityRows = multi ? fuseDensityRows(rawDensity) : parseDensityRows(rawDensity)
      const recording = fuseRanges(rawAvailability)
      // The DENSITY half keeps its scope-size branch: a singular density answer
      // carries no per-camera head to read, so it is still taken at its word.
      const knowledge = multi
        ? mergeKnowledge(ask, rawDensity, rawAvailability)
        : resolveScopeKnowledge({ ask, rows: parseScopeRowHeads(rawAvailability) })

      const motion = densityToMotionBuckets(densityRows, bucketMs)
      const audio = densityToAudioBuckets(densityRows, bucketMs)

      log.info('timeline-activity', 'fetched', {
        deviceId: ask.asked[0],
        scope: ask.asked.length,
        densityRows: densityRows.length,
        audioBuckets: audio.filter((b) => b.intensity > 0).length,
        recordingRanges: recording.length,
        unknown: knowledge.unknownIds.length,
      })

      return {
        recording,
        motion,
        audio,
        unknownIds: knowledge.unknownIds,
        overflowIds: knowledge.overflowIds,
        verdict: knowledge.verdict,
      }
    },
  })

  return {
    activity: query.data ?? EMPTY_ACTIVITY,
    loading: query.isLoading,
    failed: query.isError,
    fetching: query.isFetching,
    refetch: () => {
      void query.refetch()
    },
  }
}
