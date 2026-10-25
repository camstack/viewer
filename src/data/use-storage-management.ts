/**
 * Storage / events management data hooks — the viewer side of the recorder's
 * `recording` management surface (`getStorageUsage` / `pruneFootage` /
 * `deleteFootprint`) and the `pipelineAnalytics` events-store management surface
 * (`getEventStoreFootprint` / `pruneEvents` / `deleteDeviceEvents`).
 *
 * The SDK proxy types may not yet carry these admin methods, so calls go through
 * the defensive `capQuery` / `capMutate` helpers (structural, NOT_FOUND → null),
 * same convention as `use-exports.ts`. The record shapes the UI reads are pinned
 * here, mirroring the caps' Zod schemas.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capMutate, capQuery, isRecord } from './cap-query.js'
import { log } from '../lib/logger.js'

// ── Shared vocab ────────────────────────────────────────────────────────────

/** Why a management op ran. Mirrors `OpsLogReasonSchema`. */
export type OpsLogReason = 'retention' | 'quota' | 'manual' | 'operator'

// ── Recording storage shapes (mirror `recording.cap.ts`) ────────────────────

/** Recording bytes on disk for one camera. */
export interface RecordingDeviceUsage {
  readonly deviceId: number
  readonly usedBytes: number
}

/** Recording usage + capacity for one storage location. */
export interface RecordingLocationUsage {
  readonly locationId: string | null
  readonly usedBytes: number
  readonly availableBytes: number | null
  readonly totalBytes: number | null
}

/** Aggregate recordings usage for a node: total + per-camera + per-location. */
export interface RecordingStorageUsage {
  readonly nodeId: string
  readonly totalUsedBytes: number
  readonly devices: readonly RecordingDeviceUsage[]
  readonly locations: readonly RecordingLocationUsage[]
}

/** Result of `pruneFootage`. */
export interface PruneFootageResult {
  readonly floorMs: number | null
  readonly deletedBuckets: number
  readonly reclaimedBytes: number
}

/** Result of `deleteFootprint`. */
export interface DeleteFootprintResult {
  readonly deletedBuckets: number
  readonly reclaimedBytes: number
}

// ── Event-store shapes (mirror `pipeline-analytics.cap.ts`) ──────────────────

/** Event-store footprint for one camera. */
export interface EventStoreDeviceFootprint {
  readonly deviceId: number
  readonly rows: number
  readonly bytes: number
}

/** Aggregate event-store footprint: global totals + per-camera breakdown. */
export interface EventStoreFootprint {
  readonly totalRows: number
  readonly totalBytes: number
  readonly devices: readonly EventStoreDeviceFootprint[]
}

/** Per-kind counts returned by the event prune / device-delete mutations. */
export interface EventPruneCounts {
  readonly motion: number
  readonly object: number
  readonly audio: number
}

// ── Narrowers ───────────────────────────────────────────────────────────────

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function toStorageUsage(raw: unknown): RecordingStorageUsage | null {
  if (!isRecord(raw)) return null
  const devices: RecordingDeviceUsage[] = []
  if (Array.isArray(raw.devices)) {
    for (const d of raw.devices) {
      if (isRecord(d) && typeof d.deviceId === 'number') {
        devices.push({ deviceId: d.deviceId, usedBytes: num(d.usedBytes) })
      }
    }
  }
  const locations: RecordingLocationUsage[] = []
  if (Array.isArray(raw.locations)) {
    for (const l of raw.locations) {
      if (!isRecord(l)) continue
      locations.push({
        locationId: typeof l.locationId === 'string' ? l.locationId : null,
        usedBytes: num(l.usedBytes),
        availableBytes: numOrNull(l.availableBytes),
        totalBytes: numOrNull(l.totalBytes),
      })
    }
  }
  return {
    nodeId: typeof raw.nodeId === 'string' ? raw.nodeId : '',
    totalUsedBytes: num(raw.totalUsedBytes),
    devices,
    locations,
  }
}

function toEventFootprint(raw: unknown): EventStoreFootprint | null {
  if (!isRecord(raw)) return null
  const devices: EventStoreDeviceFootprint[] = []
  if (Array.isArray(raw.devices)) {
    for (const d of raw.devices) {
      if (isRecord(d) && typeof d.deviceId === 'number') {
        devices.push({ deviceId: d.deviceId, rows: num(d.rows), bytes: num(d.bytes) })
      }
    }
  }
  return { totalRows: num(raw.totalRows), totalBytes: num(raw.totalBytes), devices }
}

function toEventPruneCounts(raw: unknown): EventPruneCounts {
  if (!isRecord(raw)) return { motion: 0, object: 0, audio: 0 }
  return { motion: num(raw.motion), object: num(raw.object), audio: num(raw.audio) }
}

// ── Query keys ───────────────────────────────────────────────────────────────

const STORAGE_KEY = ['v2', 'storage-usage'] as const
const EVENT_FOOTPRINT_KEY = ['v2', 'event-footprint'] as const

// ── Recording hooks ───────────────────────────────────────────────────────────

/** Node recordings usage (total + per-camera + per-location). `[]`/null when the
 *  cap is absent or not connected. */
export function useStorageUsage(enabled = true): UseQueryResult<RecordingStorageUsage | null> {
  const { controller, state } = useConnection()
  return useQuery<RecordingStorageUsage | null>({
    queryKey: STORAGE_KEY,
    enabled: enabled && state === 'connected',
    staleTime: 10_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'recordingArchive',
        'getStorageUsage',
        // `getStorageUsage` input is `z.object({})` (NOT `z.void()`), so an
        // omitted arg reaches Zod as `undefined` and fails validation
        // ("expected object, received undefined") → swallowed to null → the
        // UI reads 0. Pass an explicit empty object.
        {},
      )
      const usage = toStorageUsage(raw)
      log.info('storage', 'getStorageUsage', { devices: usage?.devices.length ?? 0 })
      return usage
    },
  })
}

/** Apply a camera's retention policy now (returns the retention floor). */
export function usePruneFootage(): UseMutationResult<
  PruneFootageResult | null,
  Error,
  { readonly deviceId: number; readonly reason?: OpsLogReason }
> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ deviceId, reason }) => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const input: Record<string, unknown> = { deviceId }
      if (reason !== undefined) input.reason = reason
      const raw = await capMutate(
        system.trpcClient as Record<string, unknown>,
        'recordingArchive',
        'pruneFootage',
        input,
      )
      if (!isRecord(raw)) return null
      return {
        floorMs: numOrNull(raw.floorMs),
        deletedBuckets: num(raw.deletedBuckets),
        reclaimedBytes: num(raw.reclaimedBytes),
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_KEY })
    },
  })
}

/** Delete a camera's footage — the whole footprint, or a `[fromMs,toMs)` window
 *  when either bound is given. Destructive. */
export function useDeleteFootprint(): UseMutationResult<
  DeleteFootprintResult | null,
  Error,
  { readonly deviceId: number; readonly fromMs?: number; readonly toMs?: number }
> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ deviceId, fromMs, toMs }) => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const input: Record<string, unknown> = { deviceId }
      if (fromMs !== undefined) input.fromMs = fromMs
      if (toMs !== undefined) input.toMs = toMs
      const raw = await capMutate(
        system.trpcClient as Record<string, unknown>,
        'recordingArchive',
        'deleteFootprint',
        input,
      )
      if (!isRecord(raw)) return null
      return { deletedBuckets: num(raw.deletedBuckets), reclaimedBytes: num(raw.reclaimedBytes) }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_KEY })
    },
  })
}

// ── Event-store hooks ──────────────────────────────────────────────────────────

/** Durable event-store footprint (rows + media bytes, total + per-camera). */
export function useEventStoreFootprint(enabled = true): UseQueryResult<EventStoreFootprint | null> {
  const { controller, state } = useConnection()
  return useQuery<EventStoreFootprint | null>({
    queryKey: EVENT_FOOTPRINT_KEY,
    enabled: enabled && state === 'connected',
    staleTime: 10_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'pipelineAnalytics',
        'getEventStoreFootprint',
        // `z.object({})` input — see getStorageUsage note; omitting the arg
        // sends `undefined` and Zod rejects it. Pass an explicit empty object.
        {},
      )
      const fp = toEventFootprint(raw)
      log.info('events', 'getEventStoreFootprint', { devices: fp?.devices.length ?? 0 })
      return fp
    },
  })
}

/** Cluster-wide prune of events older than `olderThanMs` (exclusive). */
export function usePruneEvents(): UseMutationResult<
  EventPruneCounts,
  Error,
  { readonly olderThanMs: number; readonly reason?: OpsLogReason }
> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ olderThanMs, reason }) => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const input: Record<string, unknown> = { olderThanMs }
      if (reason !== undefined) input.reason = reason
      const raw = await capMutate(
        system.trpcClient as Record<string, unknown>,
        'pipelineAnalytics',
        'pruneEvents',
        input,
      )
      return toEventPruneCounts(raw)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EVENT_FOOTPRINT_KEY })
    },
  })
}

/** Delete EVERY event (motion + object + audio) for one camera. Destructive. */
export function useDeleteDeviceEvents(): UseMutationResult<EventPruneCounts, Error, number> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (deviceId) => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw = await capMutate(
        system.trpcClient as Record<string, unknown>,
        'pipelineAnalytics',
        'deleteDeviceEvents',
        { deviceId },
      )
      return toEventPruneCounts(raw)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EVENT_FOOTPRINT_KEY })
    },
  })
}
