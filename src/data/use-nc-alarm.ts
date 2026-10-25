/**
 * use-nc-alarm — TanStack Query hooks over the Notification Center's ALARM
 * bridge actions (`nc-alarm.ts`, D630).
 *
 * A sibling of `use-notification-center.ts` (like `use-nc-rule-test.ts`)
 * rather than more of it: that file is past the size this repo allows.
 *
 * Every action here is ADMIN-ONLY on the hub, so every read is asked only by a
 * CONFIRMED admin — a request the hub will refuse is not worth making, and a
 * refused read must never be taken for "no panel" by anyone but the control,
 * which falls back to the device cap for exactly that case (an older hub
 * refuses `nc.getAlarmStatus` by name).
 *
 * Every write invalidates the status in `onSettled`, not `onSuccess`: a REFUSED
 * arm is a success on the wire and still changes what the panel reports
 * (its openings were just read), and a failed one may have moved it anyway.
 */
import { useEffect, useRef, useState } from 'react'
import { NC_ALARM_SENSORS_MAX } from '@camstack/types/client'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
  type QueryCache,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  alarmSensorReadChunks,
  alarmSensorsHubTooOld,
  alarmSwitchOutcome,
  alarmSwitchPatch,
  beginAlarmSwitch,
  type AlarmSensorRow,
  type AlarmSwitchBegin,
  type AlarmSwitchWrite,
} from '../components/notifications/alarm-sensor-table-model.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import type { SystemController } from '../connection/system-controller.js'
import {
  NC_ALARM_SLOW_POLL_MS,
  ncAlarmPanelFrom,
  ncAlarmStatusIntervalMs,
  ncAlarmStatusShouldRetry,
  type AlarmArmMode,
  type NcAlarmArmOutcome,
  type NcAlarmConfig,
  type NcAlarmLive,
  type NcAlarmPanelSource,
  type NcAlarmSensors,
  type NcAlarmSettingsPatch,
  type NcAlarmStatus,
  type NcPanelLookup,
} from './nc-alarm.js'
import { RECONCILE_MS } from './reconcile.js'
import { ncNotConnectedError } from './nc-errors.js'
import { useAdminVerdict } from './use-me.js'
import { ncClientForTrpc } from './use-notification-center.js'

const ALARM_STATUS_KEY = ['v2', 'nc', 'alarm-status'] as const
const ALARM_CONFIG_KEY = ['v2', 'nc', 'alarm-config'] as const
// The prefix every alarm key shares (`v2` = the app's query-key namespace, so a
// namespace-wide invalidation reaches it). The sensors key is a PREFIX: the
// asked ids follow it, and `useNcAlarmSensors` matches on the prefix alone.
export const ALARM_SENSORS_KEY = ['v2', 'nc', 'alarm-sensors'] as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A status query's state, as the pure lookup reads it (the failure reason counts while retrying). */
function sourceOf(query: Query<NcAlarmStatus, Error>): NcAlarmPanelSource {
  return { data: query.state.data, error: query.state.error ?? query.state.fetchFailureReason }
}

/**
 * `nc.getAlarmStatus` — asked only by a confirmed admin, for the alarm row of
 * `deviceId`.
 *
 * Only the NC panel's own row polls it (`ncAlarmStatusIntervalMs`); any other
 * alarm row reads it once for the panel id. A refusal BY NAME (older hub, no
 * panel) is final; any other failure is retried with react-query's backoff,
 * and keeps being asked while it stays unknown.
 */
export function useNcAlarmStatus(deviceId: number): UseQueryResult<NcAlarmStatus> {
  const { controller, state } = useConnection()
  const verdict = useAdminVerdict()
  return useQuery<NcAlarmStatus>({
    queryKey: ALARM_STATUS_KEY,
    enabled: state === 'connected' && verdict === 'admin',
    // Paired with the interval (reconcile.ts); a row that does not poll holds
    // its answer for the reconcile window rather than re-asking on remount.
    staleTime: (query) => ncAlarmStatusIntervalMs(deviceId, sourceOf(query)) || RECONCILE_MS,
    refetchInterval: (query) => ncAlarmStatusIntervalMs(deviceId, sourceOf(query)),
    retry: ncAlarmStatusShouldRetry,
    queryFn: async (): Promise<NcAlarmStatus> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      return ncClientForTrpc(system.trpcClient).getAlarmStatus()
    },
  })
}

/** What the alarm row of `deviceId` knows about the NC panel. */
export interface NcAlarmRowView {
  readonly lookup: NcPanelLookup
  /** The NC panel's live view — only when this row IS that panel. */
  readonly live: NcAlarmLive | null
  /** When that view was fetched (`dataUpdatedAt`); null without one. */
  readonly liveAt: number | null
}

export function useNcAlarmRow(deviceId: number): NcAlarmRowView {
  const { data, error, failureReason, dataUpdatedAt } = useNcAlarmStatus(deviceId)
  const lookup = ncAlarmPanelFrom({ data, error: error ?? failureReason })
  const isPanel = lookup.kind === 'known' && lookup.panelId === deviceId
  const live = isPanel ? (data?.live ?? null) : null
  return { lookup, live, liveAt: live !== null ? dataUpdatedAt : null }
}

/** One `nc.getAlarmConfig` read over the controller's live system. */
function readAlarmConfig(controller: SystemController): Promise<NcAlarmConfig> {
  const system = controller.getSystem()
  if (!system) return Promise.reject(ncNotConnectedError())
  return ncClientForTrpc(system.trpcClient).getAlarmConfig()
}

/** `nc.getAlarmConfig` — the admin's delays, recipients and non-blocking lists. */
export function useNcAlarmConfig(): UseQueryResult<NcAlarmConfig> {
  const { controller, state } = useConnection()
  const verdict = useAdminVerdict()
  return useQuery<NcAlarmConfig>({
    queryKey: ALARM_CONFIG_KEY,
    enabled: state === 'connected' && verdict === 'admin',
    staleTime: NC_ALARM_SLOW_POLL_MS,
    retry: false,
    queryFn: () => readAlarmConfig(controller),
  })
}

/**
 * Ask the hub for the config NOW — never the cache. A Save merges its draft
 * onto this answer: nothing refetches the cached config while the screen is
 * open (no interval, no focus refetch), so a merge onto the cache would
 * revert whatever another admin changed meanwhile. The answer also lands in
 * the cache, so the screen shows it.
 */
export function useFetchFreshAlarmConfig(): () => Promise<NcAlarmConfig> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return () =>
    queryClient.fetchQuery<NcAlarmConfig>({
      queryKey: ALARM_CONFIG_KEY,
      staleTime: 0,
      retry: false,
      queryFn: () => readAlarmConfig(controller),
    })
}

/** Re-read everything an alarm write can change, whatever it came to. */
function useInvalidateAlarm(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ALARM_STATUS_KEY }),
      queryClient.invalidateQueries({ queryKey: ALARM_CONFIG_KEY }),
    ])
  }
}

/** Arm the NC panel into a mode. A refusal RESOLVES (`outcome: 'refused'`). */
export function useNcArmAlarm(): UseMutationResult<NcAlarmArmOutcome, Error, AlarmArmMode> {
  const { controller } = useConnection()
  const invalidate = useInvalidateAlarm()
  return useMutation<NcAlarmArmOutcome, Error, AlarmArmMode>({
    mutationFn: async (mode): Promise<NcAlarmArmOutcome> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      return ncClientForTrpc(system.trpcClient).armAlarm(mode)
    },
    onSettled: invalidate,
  })
}

/**
 * Arm anyway, bound to ONE refusal. The hub holds that id in RAM, one-shot, for
 * `ARM_ANYWAY_TTL_MS`: a stale, expired, used or forgotten id RESOLVES as
 * `outcome: 'rejected'`, and a device that opened since is a NEW refusal.
 */
export function useNcArmAlarmAnyway(): UseMutationResult<NcAlarmArmOutcome, Error, string> {
  const { controller } = useConnection()
  const invalidate = useInvalidateAlarm()
  return useMutation<NcAlarmArmOutcome, Error, string>({
    mutationFn: async (refusalId): Promise<NcAlarmArmOutcome> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      return ncClientForTrpc(system.trpcClient).armAlarmAnyway(refusalId)
    },
    onSettled: invalidate,
  })
}

/** Disarm the NC panel. */
export function useNcDisarmAlarm(): UseMutationResult<void, Error, void> {
  const { controller } = useConnection()
  const invalidate = useInvalidateAlarm()
  return useMutation<void, Error, void>({
    mutationFn: async (): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      await ncClientForTrpc(system.trpcClient).disarmAlarm()
    },
    onSettled: invalidate,
  })
}

/** Patch the alarm settings; the hub's answer is what the screen then shows. */
export function useNcSetAlarmConfig(): UseMutationResult<NcAlarmConfig, Error, NcAlarmSettingsPatch> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  const invalidate = useInvalidateAlarm()
  return useMutation<NcAlarmConfig, Error, NcAlarmSettingsPatch>({
    mutationFn: async (patch): Promise<NcAlarmConfig> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      return ncClientForTrpc(system.trpcClient).setAlarmConfig(patch)
    },
    onSuccess: (config) => {
      queryClient.setQueryData(ALARM_CONFIG_KEY, config)
    },
    onSettled: invalidate,
  })
}

// -- Sensor states (D697) -------------------------------------------

/** How often the states are re-read: fast while the panel is moving. */
export const ALARM_SENSORS_ACTIVE_MS = 5_000
export const ALARM_SENSORS_IDLE_MS = 15_000
/** A failed read is retried this many times (a by-name refusal never). */
export const ALARM_SENSORS_MAX_RETRIES = 2

/**
 * The poll interval of the sensors read. A hub that refused the read BY NAME
 * will not learn the method by being asked again - stop (the screen says so,
 * once).
 */
export function alarmSensorsRefetchMs(active: boolean, error: unknown): number | false {
  if (error !== null && error !== undefined && alarmSensorsHubTooOld(errorMessage(error))) return false
  return active ? ALARM_SENSORS_ACTIVE_MS : ALARM_SENSORS_IDLE_MS
}

export function alarmSensorsShouldRetry(failures: number, error: unknown): boolean {
  return !alarmSensorsHubTooOld(errorMessage(error)) && failures < ALARM_SENSORS_MAX_RETRIES
}

/**
 * How long a by-name refusal holds. The hub may be upgraded while the app
 * stays open, so the refusal expires; a reconnect (see `useNcAlarmSensors`)
 * ends it sooner.
 */
export const ALARM_SENSORS_REFUSAL_TTL_MS = 10 * 60_000

/** Is any sensors read carrying a FRESH by-name refusal at `now`? */
export function alarmSensorsRefused(cache: QueryCache, now: number = Date.now()): boolean {
  return cache
    .findAll({ queryKey: ALARM_SENSORS_KEY })
    .some(
      (q) =>
        q.state.error !== null &&
        now - q.state.errorUpdatedAt < ALARM_SENSORS_REFUSAL_TTL_MS &&
        alarmSensorsHubTooOld(errorMessage(q.state.error)),
    )
}

/** Drop the sensors reads that ended in an error (a reconnect may mean a new hub). */
export function forgetAlarmSensorsRefusals(cache: QueryCache): void {
  for (const q of cache.findAll({ queryKey: ALARM_SENSORS_KEY })) {
    if (q.state.error !== null) cache.remove(q)
  }
}

/**
 * Read the states in chunks of at most `NC_ALARM_SENSORS_MAX` ids, IN SEQUENCE
 * (one household is a handful of calls; parallel chunks would multiply the
 * hub's cross-process reads), and merge them. One failed chunk fails the read:
 * a half answer would show the other half as "not answered" (D315).
 */
export async function readAlarmSensorsChunked(
  ids: readonly number[],
  read: (chunk: readonly number[]) => Promise<NcAlarmSensors>,
): Promise<NcAlarmSensors> {
  const answers: NcAlarmSensors[] = []
  for (const chunk of alarmSensorReadChunks(ids, NC_ALARM_SENSORS_MAX)) answers.push(await read(chunk))
  return {
    sensors: answers.flatMap((a) => a.sensors),
    // The oldest chunk bounds how fresh the whole read is.
    readAt: answers.length === 0 ? 0 : Math.min(...answers.map((a) => a.readAt)),
  }
}

/** The states of the asked openings - only while the alarm screen is FOCUSED. */
export function useNcAlarmSensors(
  ids: readonly number[],
  active: boolean,
  focused: boolean,
): UseQueryResult<NcAlarmSensors> {
  const { controller, state } = useConnection()
  const verdict = useAdminVerdict()
  const queryClient = useQueryClient()
  // A hub that refused the read BY NAME will not learn it by being asked again,
  // and an errored query has no data, so it is always stale: a refocus would
  // re-ask it. Stop asking while any sensors read carries that refusal - but
  // only for a TTL, and not across a reconnect: the hub may have been upgraded.
  // This scan runs each render and relies on the query observer re-rendering
  // the component when the read errors (the cache itself is not subscribed to
  // here); the TTL is likewise only noticed on the next render (a refocus or
  // the next state change), which is when a new read would start anyway.
  const hubTooOld = alarmSensorsRefused(queryClient.getQueryCache())
  const [, setForgotten] = useState(0)
  const wasConnected = useRef(state === 'connected')
  useEffect(() => {
    const connected = state === 'connected'
    if (connected && !wasConnected.current) {
      forgetAlarmSensorsRefusals(queryClient.getQueryCache())
      // Removing a query does not re-render a disabled observer: do it here so
      // the gate is re-evaluated against the emptied cache.
      setForgotten((n) => n + 1)
    }
    wasConnected.current = connected
  }, [state, queryClient])
  return useQuery<NcAlarmSensors>({
    queryKey: [...ALARM_SENSORS_KEY, ids],
    enabled: state === 'connected' && verdict === 'admin' && focused && ids.length > 0 && !hubTooOld,
    // A change of the candidate set must not flash every row back to "Checking...".
    placeholderData: keepPreviousData,
    refetchInterval: (query) => alarmSensorsRefetchMs(active, query.state.error),
    retry: alarmSensorsShouldRetry,
    queryFn: () =>
      readAlarmSensorsChunked(ids, (chunk) => {
        const system = controller.getSystem()
        if (!system) return Promise.reject(ncNotConnectedError())
        return ncClientForTrpc(system.trpcClient).getAlarmSensors(chunk)
      }),
  })
}

// -- The switch (D697) ----------------------------------------------

export type NcAlarmSwitchNotice =
  | { readonly kind: 'refused'; readonly inFlight: AlarmSwitchWrite }
  | { readonly kind: 'not-landed'; readonly write: AlarmSwitchWrite }
  | { readonly kind: 'failed'; readonly write: AlarmSwitchWrite; readonly error: string }

export interface NcAlarmSwitch {
  readonly inFlight: AlarmSwitchWrite | null
  readonly notice: NcAlarmSwitchNotice | null
  readonly press: (
    mode: AlarmArmMode,
    row: AlarmSensorRow,
    kind: 'blocks' | 'secureOnArm',
    nextValue: boolean,
  ) => void
}

/** Pure: what a press does given the in-flight write - tested without React. */
export function alarmSwitchPress(
  inFlight: AlarmSwitchWrite | null,
  mode: AlarmArmMode,
  row: AlarmSensorRow,
  kind: 'blocks' | 'secureOnArm',
  nextValue: boolean,
): AlarmSwitchBegin {
  return beginAlarmSwitch(inFlight, mode, row, kind, nextValue)
}

/**
 * One membership write at a time. The gate is a REF (two presses in one tick
 * cannot both start), mirrored into state for rendering. The hub's answer is
 * what the screen then shows: `landed` replaces the cached config, anything
 * else is said and the alarm queries are re-read. No optimistic flip.
 */
export function useNcAlarmSwitch(): NcAlarmSwitch {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  const invalidate = useInvalidateAlarm()
  const gate = useRef<AlarmSwitchWrite | null>(null)
  const [inFlight, setInFlight] = useState<AlarmSwitchWrite | null>(null)
  const [notice, setNotice] = useState<NcAlarmSwitchNotice | null>(null)

  const run = async (write: AlarmSwitchWrite): Promise<void> => {
    try {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const answer = await ncClientForTrpc(system.trpcClient).setAlarmConfig(alarmSwitchPatch(write))
      if (alarmSwitchOutcome(write, answer.settings).kind === 'landed') {
        queryClient.setQueryData(ALARM_CONFIG_KEY, answer)
      } else {
        setNotice({ kind: 'not-landed', write })
        void invalidate()
      }
    } catch (error) {
      setNotice({ kind: 'failed', write, error: errorMessage(error) })
      void invalidate()
    } finally {
      gate.current = null
      setInFlight(null)
      // "Wait for it to finish" is stale the moment it has finished.
      setNotice((current) => (current?.kind === 'refused' ? null : current))
    }
  }

  const press = (
    mode: AlarmArmMode,
    row: AlarmSensorRow,
    kind: 'blocks' | 'secureOnArm',
    nextValue: boolean,
  ): void => {
    const begin = alarmSwitchPress(gate.current, mode, row, kind, nextValue)
    if (begin.kind === 'refused') {
      setNotice({ kind: 'refused', inFlight: begin.inFlight })
      return
    }
    gate.current = begin.write
    setInFlight(begin.write)
    setNotice(null)
    void run(begin.write)
  }

  return { inFlight, notice, press }
}
