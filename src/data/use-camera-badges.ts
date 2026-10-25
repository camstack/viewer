/**
 * useCameraBadges — every card's badge values in ONE call, with the per-camera
 * calls as the fallback.
 *
 * ## The cost this removes
 *
 * A card's badges each had their own procedure: the battery here, the recording
 * mode there. This client runs `wsLink` with no `httpBatchLink`, so every one
 * of those is its own message on the single WebSocket that also carries the
 * WebRTC signalling — a ten-camera list meant twenty messages per reconcile
 * competing with the seconds that decide how fast a stream appears. Collapsing
 * them cannot happen at the transport, so it happens at the procedure:
 * `deviceManager.getDeviceStatusAggregateBatch` returns the same per-cap status
 * records for a LIST of devices.
 *
 * ## Why the fallback is not optional
 *
 * The batch is a framework change, and a framework change is not live until a
 * `@camstack/server` containing it is installed — regardless of what is in the
 * registry (see `docs/architecture/update-and-release.md`). Every hub in the
 * field today answers NOT_FOUND, so the fallback is not a defensive flourish:
 * it is the path that actually runs until that release lands. `supported`
 * distinguishes "the aggregate said this camera has no battery" from "the
 * aggregate does not exist", which are the same `null` and must not be the
 * same decision.
 */
import { useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, isRecord } from './cap-query.js'
import { RECONCILE_MS } from './reconcile.js'
import type { BatteryStatus } from './use-battery.js'
import { type NetworkLinkStatus, toNetworkLink } from './use-network-link.js'
import type { RecordingMode } from './use-recording.js'

/** The caps the badges read. Naming them keeps the call from sweeping every
 *  status-carrying cap × every device for two values. */
export const BADGE_CAPS: readonly string[] = ['battery', 'recording-archive', 'network-link']

export interface CameraBadgeRow {
  readonly battery: BatteryStatus | null
  /** Null means the aggregate could not read this cap. The card must fall back
   *  to the authoritative per-camera config query instead of painting green. */
  readonly recordingMode: RecordingMode | null
  /** The camera's own link; null when it has no slice or the hub is older. */
  readonly networkLink: NetworkLinkStatus | null
}

export interface CameraBadges {
  /** False when the hub has no batch procedure — callers keep their own polls. */
  readonly supported: boolean
  readonly byId: Readonly<Record<number, CameraBadgeRow>>
}

const UNSUPPORTED: CameraBadges = Object.freeze({ supported: false, byId: Object.freeze({}) })

function toBattery(raw: unknown): BatteryStatus | null {
  if (!isRecord(raw)) return null
  if (typeof raw.percentage !== 'number') return null
  const charging = raw.charging
  const battery: {
    percentage: number
    charging: 'dc' | 'solar' | 'none' | 'unknown'
    sleeping: boolean
    binary?: boolean
  } = {
    percentage: raw.percentage,
    // 'none' is a NEGATIVE the hub reported; anything it did not say is unknown.
    charging:
      charging === 'dc' || charging === 'solar' || charging === 'none' ? charging : 'unknown',
    sleeping: raw.sleeping === true,
  }
  if (raw.binary === true) battery.binary = true
  return battery
}

function toRecordingMode(raw: unknown): RecordingMode | null {
  if (!isRecord(raw)) return null
  // The status carries `activeMode` — what the recorder is DOING — where the
  // per-device config carries the authored `mode`. For a badge that reports
  // "this camera is recording", the active one is the honest field.
  const mode = raw.activeMode
  return mode === 'continuous' || mode === 'events' || mode === 'off' ? mode : null
}

/** Narrow the batch payload. Exported for the unit test — the shape crosses the
 *  wire as `Record<string, Record<string, unknown>>` and nothing else checks it. */
export function parseBadgeBatch(raw: unknown): Readonly<Record<number, CameraBadgeRow>> | null {
  if (!isRecord(raw)) return null
  const byId: Record<number, CameraBadgeRow> = {}
  for (const [key, value] of Object.entries(raw)) {
    const id = Number(key)
    if (!Number.isInteger(id) || !isRecord(value)) continue
    byId[id] = {
      battery: toBattery(value.battery),
      // Keyed by CAP NAME, and the status block lives on `recording-archive`
      // since D625 — `recording` is the device collection now and declares no
      // status at all, so a row read under the old key is silently null for
      // every camera and the badge never leaves "unknown".
      recordingMode: toRecordingMode(value['recording-archive']),
      networkLink: toNetworkLink(value['network-link']),
    }
  }
  return byId
}

/**
 * Badge values for a set of cameras.
 *
 * The query key is the sorted id LIST, so every card on a screen shares one
 * entry — the same mistake the event-kind fetch made (keying per caller minted
 * one query per camera for identical data) is the one this avoids by
 * construction.
 */
export function useCameraBadges(
  deviceIds: readonly number[],
  enabled: boolean,
): UseQueryResult<CameraBadges> {
  const { controller, state } = useConnection()
  const ids = useMemo(() => [...deviceIds].sort((a, b) => a - b), [deviceIds])
  return useQuery<CameraBadges>({
    queryKey: ['v2', 'camera-badges', ids],
    enabled: enabled && ids.length > 0 && state === 'connected',
    // Paired with the interval on purpose: without it the global 5s
    // default makes this stale long before its own cadence, so every
    // remount refetches and the reconcile design does nothing.
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return UNSUPPORTED
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'deviceManager',
        'getDeviceStatusAggregateBatch',
        { deviceIds: ids, caps: BADGE_CAPS },
      )
      const byId = parseBadgeBatch(raw)
      if (byId === null) return UNSUPPORTED
      return { supported: true, byId }
    },
  })
}

/**
 * What ONE camera reads out of the screen's aggregate.
 *
 * A discriminated union, not a flag plus a nullable row: `supported` and
 * "there is a row" are the same fact. The unsupported arm also says whether the
 * aggregate has ANSWERED — `pending` is the aggregate still in flight, and a
 * caller must not fall back to its own query on it (D315: not-yet-known must
 * never look like not-installed). Read as "unsupported" it made every card ask
 * for itself at boot: 27 cameras × battery + link + recording mode was the
 * thousand-query burst in every boot minute.
 */
export type CameraBadgeSlice =
  | { readonly supported: true; readonly row: CameraBadgeRow }
  | { readonly supported: false; readonly row: null; readonly pending: boolean }

export interface CameraBadgeAggregate {
  readonly pending: boolean
  readonly supported: boolean
  readonly byId: Readonly<Record<number, CameraBadgeRow>>
}

const UNSUPPORTED_SLICE: CameraBadgeSlice = Object.freeze({ supported: false, row: null, pending: false })
const PENDING_SLICE: CameraBadgeSlice = Object.freeze({ supported: false, row: null, pending: true })

/**
 * `supported` is false when there is no aggregate, when the hub has no batch
 * procedure, AND when the aggregate simply has no row for this device — all
 * three mean the same thing to a caller: keep your own query. Pending is the
 * fourth answer, and the one that means WAIT.
 */
export function resolveBadgeSlice(aggregate: CameraBadgeAggregate | null, deviceId: number): CameraBadgeSlice {
  if (aggregate === null) return UNSUPPORTED_SLICE
  if (aggregate.pending) return PENDING_SLICE
  const row = aggregate.byId[deviceId] ?? null
  if (!aggregate.supported || row === null) return UNSUPPORTED_SLICE
  return { supported: true, row }
}
