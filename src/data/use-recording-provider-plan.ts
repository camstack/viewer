/**
 * How a scope's cameras are SPLIT across recording sources before anything is
 * asked.
 *
 * Every call that returns recording data goes to the source the operator
 * selected for that camera — the operator's own instruction. A scope is not one
 * source, though: three cameras on ours and one pointed at its card is four
 * cameras and two providers, and `recording`'s `provider` takes exactly one.
 *
 * So the ask is planned first:
 *
 *  - cameras on OURS ride the archive batch (`recordingArchive
 *    .getAvailabilityBatch`), which is the only shape that distinguishes an
 *    unreadable camera from a quiet one;
 *  - a camera pinned to another source gets its own singular `recording` call
 *    carrying that source's addonId;
 *  - a camera whose pick has not RESOLVED is not asked at all, and says so.
 *
 * That last one is the point. `resolveRecordingProvider` answers `addonId:
 * null` while `listSources` has not come back, and folding those cameras into
 * the ours-batch would paint our coverage under the label of the card's — the
 * exact swap D625 was written to make impossible.
 *
 * ## `listSources` is asked only for cameras that need it
 *
 * The default costs no round trip (the reserved id resolves offline), so a
 * fleet nobody has re-pointed asks nothing at all. Only cameras carrying a
 * stored pick are listed, in ONE query keyed by that id set.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useConnection } from '../connection/ConnectionProvider.js'
import { cameraRecordingProvider, useCameraPrefsStore } from '../store/camera-prefs-store.js'
import { capQuery } from './cap-query.js'
import {
  RECORDING_SOURCE_CAMSTACK_ADDON,
  parseRecordingSources,
  resolveRecordingProvider,
  type RecordingProviderChoice,
  type RecordingSourceRow,
} from './recording-sources.js'

/** One camera pinned to a source that is not ours. */
export interface PinnedRecordingAsk {
  readonly deviceId: number
  /** The addonId to send as `provider`. */
  readonly provider: string
}

/** How a scope's cameras divide across sources. */
export interface RecordingProviderPlan {
  /** Cameras reading OUR archive, in ask order. */
  readonly ours: readonly number[]
  /** Cameras reading another source, one call each. */
  readonly pinned: readonly PinnedRecordingAsk[]
  /** Cameras whose pick could not be resolved — NOT asked, and reported as
   *  unreadable so the fault slot says the scope is partial. */
  readonly unresolved: readonly number[]
  /**
   * False until the prefs store has hydrated.
   *
   * An unhydrated store answers "no pick" for every camera, and no pick MEANS
   * ours — so asking before hydration paints one frame of our bar over a
   * camera the operator had pointed somewhere else.
   */
  readonly ready: boolean
}

const EMPTY_PLAN: RecordingProviderPlan = Object.freeze({
  ours: Object.freeze([]) as readonly number[],
  pinned: Object.freeze([]) as readonly PinnedRecordingAsk[],
  unresolved: Object.freeze([]) as readonly number[],
  ready: false,
}) as RecordingProviderPlan

/** A stable cache key for a set of ids. */
function idsKey(ids: readonly number[]): string {
  return [...ids].sort((a, b) => a - b).join(',')
}

/**
 * `recording.listSources` for the cameras that carry a stored pick.
 *
 * One query for the whole set. A camera whose list could not be read comes
 * back ABSENT from the map rather than as an empty list: empty would make
 * `resolveRecordingProvider` call the pick `missing` — a claim — when the
 * truth is that nobody looked (D315).
 */
function useRecordingSourcesFor(
  deviceIds: readonly number[],
): ReadonlyMap<number, readonly RecordingSourceRow[]> {
  const { controller, state } = useConnection()
  const key = idsKey(deviceIds)
  const query = useQuery<ReadonlyMap<number, readonly RecordingSourceRow[]>>({
    queryKey: ['v2', 'recording', 'sources', key],
    enabled: state === 'connected' && deviceIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      const out = new Map<number, readonly RecordingSourceRow[]>()
      if (!system) return out
      const client = system.trpcClient as unknown as Record<string, unknown>
      await Promise.all(
        deviceIds.map(async (deviceId) => {
          const raw = await capQuery(client, 'recording', 'listSources', {
            deviceId,
          })
          // `null` is "could not read" — leave the camera out of the map.
          if (raw === null) return
          out.set(deviceId, parseRecordingSources(raw))
        }),
      )
      return out
    },
  })
  return query.data ?? EMPTY_SOURCES
}

const EMPTY_SOURCES: ReadonlyMap<number, readonly RecordingSourceRow[]> = new Map()

/**
 * Split `deviceIds` by the source each camera is set to read.
 *
 * @param deviceIds - the ids that will ride the request, in ask order.
 */
export function useRecordingProviderPlan(deviceIds: readonly number[]): RecordingProviderPlan {
  const prefs = useCameraPrefsStore((s) => s.prefs)
  const hydrated = useCameraPrefsStore((s) => s.hydrated)
  const hydrate = useCameraPrefsStore((s) => s.hydrate)

  // Trigger hydration here rather than assuming somebody else did. `ready`
  // gates every recording read in the app, so a plan that only WAITS for the
  // store leaves the timeline blank forever on any screen that mounts no other
  // prefs hook. Idempotent, like the other prefs hooks.
  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // Which cameras carry a pick at all. Everything else resolves offline.
  const picked = useMemo(() => {
    if (!hydrated) return []
    return deviceIds.filter((id) => cameraRecordingProvider(prefs, id) !== undefined)
  }, [deviceIds, prefs, hydrated])

  const sources = useRecordingSourcesFor(picked)

  return useMemo(() => {
    if (!hydrated) return EMPTY_PLAN
    const ours: number[] = []
    const pinned: PinnedRecordingAsk[] = []
    const unresolved: number[] = []
    for (const deviceId of deviceIds) {
      const chosen = cameraRecordingProvider(prefs, deviceId)
      const rows = sources.get(deviceId)
      // Known only when THIS camera's list came back. A sibling answering
      // establishes nothing about this one.
      const choice: RecordingProviderChoice = resolveRecordingProvider(
        chosen,
        rows ?? [],
        rows !== undefined,
      )
      if (choice.addonId === null) {
        unresolved.push(deviceId)
        continue
      }
      if (choice.derivation === 'default') ours.push(deviceId)
      else pinned.push({ deviceId, provider: choice.addonId })
    }
    return { ours, pinned, unresolved, ready: true }
  }, [deviceIds, prefs, hydrated, sources])
}

/**
 * One camera's recording sources, for the picker.
 *
 * Shares the cache entry the plan fills (same key shape), so opening the menu
 * on a camera the timeline already planned for costs nothing. Empty means NOT
 * YET KNOWN as much as it means "only ours" — the picker treats fewer than two
 * rows as nothing to choose, which is the same rendering either way (D315,
 * D557 § 4).
 */
export function useRecordingSourceRows(deviceId: number): readonly RecordingSourceRow[] {
  const ids = singleIdList(deviceId)
  return useRecordingSourcesFor(ids).get(deviceId) ?? EMPTY_ROWS
}

const EMPTY_ROWS: readonly RecordingSourceRow[] = Object.freeze([])

/** A stable one-element id list, so the query key does not change per render. */
const SINGLE_ID_LISTS = new Map<number, readonly number[]>()
function singleIdList(deviceId: number): readonly number[] {
  const known = SINGLE_ID_LISTS.get(deviceId)
  if (known !== undefined) return known
  const made: readonly number[] = Object.freeze([deviceId])
  SINGLE_ID_LISTS.set(deviceId, made)
  return made
}

/** A cache key that changes whenever the plan would change the calls made. */
export function recordingPlanKey(plan: RecordingProviderPlan): string {
  if (!plan.ready) return 'unhydrated'
  const pinned = plan.pinned.map((p) => `${p.deviceId}@${p.provider}`).sort()
  return `${idsKey(plan.ours)}|${pinned.join(',')}|${idsKey(plan.unresolved)}`
}

/**
 * The availability ROWS for a plan — one array, whatever the partition.
 *
 * The single definition of "ask every camera at its own source", shared by the
 * coverage bar and the fused activity read. Two copies would be two answers to
 * "did this camera answer", and this repo has paid for that before.
 *
 * Every row carries the same head (`deviceId` + `read`), batch and singular
 * alike, so `parseScopeRowHeads` / `isReadRow` read them uniformly. Cameras
 * whose pick could not be resolved are appended as `unreadable` heads: they
 * were not asked, they are not ours, and they are not empty.
 *
 * `rethrow` throughout — a window that could not be READ must not come back as
 * a success with no spans.
 */
export async function fetchAvailabilityRows(
  client: Record<string, unknown>,
  plan: RecordingProviderPlan,
  fromMs: number,
  toMs: number,
): Promise<readonly unknown[]> {
  const calls: Promise<unknown>[] = []
  if (plan.ours.length > 1) {
    calls.push(
      capQuery(
        client,
        'recordingArchive',
        'getAvailabilityBatch',
        { deviceIds: plan.ours, fromMs, toMs },
        { rethrow: true },
      ),
    )
  } else if (plan.ours.length === 1) {
    calls.push(
      capQuery(
        client,
        'recording',
        'getAvailability',
        {
          deviceId: plan.ours[0],
          provider: RECORDING_SOURCE_CAMSTACK_ADDON,
          fromMs,
          toMs,
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
        'getAvailability',
        { deviceId: pin.deviceId, provider: pin.provider, fromMs, toMs },
        { rethrow: true },
      ),
    )
  }
  const answers = await Promise.all(calls)
  const rows: unknown[] = []
  for (const answer of answers) rows.push(...answerRows(answer))
  for (const deviceId of plan.unresolved) rows.push({ deviceId, read: 'unreadable' })
  return rows
}

/**
 * The rows one answer carries.
 *
 * A batch answers an ARRAY of rows; a singular call answers ONE row with the
 * same head. Normalising here is what lets both feed the same
 * `resolveScopeKnowledge`.
 */
export function answerRows(answer: unknown): readonly unknown[] {
  if (Array.isArray(answer)) return answer
  return answer === null || answer === undefined ? [] : [answer]
}
