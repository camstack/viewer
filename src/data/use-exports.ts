/**
 * Recording-export data hooks — the viewer side of the `recordingExport` cap
 * (`packages/types/src/capabilities/recording-export.cap.ts`). The cap is a
 * `scope:'system', mode:'singleton'` provider served by the recorder on the
 * footage node; every method carries `deviceId` (or `exportId`) in its input.
 *
 * The SDK types may not yet carry the cap, so calls go through the defensive
 * `capQuery` / `capMutate` helpers (structural, NOT_FOUND → null) instead of the
 * typed proxy. The record/option shapes the UI reads are pinned here (mirroring
 * the cap's Zod schemas), same convention as `use-ptz.ts`'s `PtzOptions`.
 *
 * Live progress rides `system.subscribeEvent` on the `recording.export.*`
 * categories; the list/detail queries poll as a fallback + self-heal.
 */
import { useCallback, useEffect, useState } from 'react'
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

/** Lifecycle state of an export job / history row. Mirrors `ExportStateSchema`. */
export type ExportState = 'queued' | 'rendering' | 'ready' | 'failed' | 'expired' | 'deleted'

/** Timelapse cadence — sample one frame per `everyMs`, output at `outputFps`. */
export interface ExportTimelapse {
  readonly everyMs: number
  readonly outputFps?: number
}

/** Render options. `speed` and `timelapse` are mutually exclusive. */
export interface ExportOptions {
  readonly speed?: number
  readonly timelapse?: ExportTimelapse
  readonly includeAudio: boolean
  readonly maxLifeMs: number
  readonly deleteAfterDownload: boolean
  readonly title?: string
  readonly notifyTargetIds?: readonly string[]
}

/** One export job / history row. Mirrors `ExportRecordSchema`. */
export interface ExportRecord {
  readonly id: string
  readonly deviceId: number
  readonly profile: string
  readonly fromMs: number
  readonly toMs: number
  readonly options: ExportOptions
  readonly state: ExportState
  readonly progressPct: number | null
  readonly fileBytes: number | null
  readonly expiresAt: number
  readonly deleteAfterDownload: boolean
  readonly downloadedAt: number | null
  readonly createdAt: number
  readonly createdBy: string
  readonly error: string | null
}

/** Candidate download URLs. Mirrors `ExportDownloadSchema`. */
export interface ExportDownload {
  readonly url: string
  readonly endpoints: readonly string[]
}

/**
 * WHAT was exported — the AUTHORITY, as opposed to the four top-level fields
 * the Library sorts and labels on (D558 § 2.2).
 *
 * Mirrored here, like every other shape in this file, because the installed
 * `@camstack/types` (1.2.235) predates D558's landing and this checkout
 * resolves `@camstack/*` from the PUBLISHED packages exactly as metro and CI
 * do. A workspace alias would type-check green and throw on first evaluation.
 *
 * Only the `clip` arm is spelled: the footage arm reaches the hub through the
 * legacy flat fields this app has always sent, and `resolveCreateExportSubject`
 * is the ONE reading of those as a subject. Spelling a second footage shape
 * here would be a second authority on a request that already has one.
 */
export interface ExportClipSubject {
  readonly kind: 'clip'
  readonly deviceId: number
  readonly provider: string
  readonly source: string
  readonly sourceLabel: string
  readonly clipId: string
  readonly catalogWindow: { readonly sinceMs: number; readonly untilMs: number }
  readonly profile: string
}

/** Input to `createExport`. `profiles` is canonical; `profile` is the legacy singular. */
export interface CreateExportInput {
  readonly deviceId: number
  readonly profile?: string
  /**
   * The footage path's stream list. OPTIONAL because a clip subject carries
   * exactly one profile of its own and the cap's refinement returns before it
   * ever looks here — sending the array as well would put the same fact in two
   * places, one of which nothing reads.
   */
  readonly profiles?: readonly string[]
  /**
   * Footage only. A clip export asks for NO time range — the camera chose the
   * boundaries — and supplying one beside a clip subject is REFUSED rather
   * than ignored (D558 § 5.4.3).
   */
  readonly fromMs?: number
  readonly toMs?: number
  /** What to export. Absent means the legacy flat footage request. */
  readonly subject?: ExportClipSubject
  readonly options: ExportOptions
}

const EXPORTS_KEY = ['v2', 'exports'] as const

/** Every export `state` string, for narrowing an unknown payload. */
const EXPORT_STATES: ReadonlySet<string> = new Set<ExportState>([
  'queued',
  'rendering',
  'ready',
  'failed',
  'expired',
  'deleted',
])

function toState(v: unknown): ExportState {
  return typeof v === 'string' && EXPORT_STATES.has(v) ? (v as ExportState) : 'failed'
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}

function toTimelapse(v: unknown): ExportTimelapse | undefined {
  if (!isRecord(v) || typeof v.everyMs !== 'number') return undefined
  return { everyMs: v.everyMs, outputFps: typeof v.outputFps === 'number' ? v.outputFps : undefined }
}

function toOptions(v: unknown): ExportOptions {
  if (!isRecord(v)) {
    return { includeAudio: false, maxLifeMs: 0, deleteAfterDownload: false }
  }
  return {
    speed: typeof v.speed === 'number' ? v.speed : undefined,
    timelapse: toTimelapse(v.timelapse),
    includeAudio: v.includeAudio === true,
    maxLifeMs: typeof v.maxLifeMs === 'number' ? v.maxLifeMs : 0,
    deleteAfterDownload: v.deleteAfterDownload === true,
    title: typeof v.title === 'string' ? v.title : undefined,
  }
}

/** Narrow an unknown row to an `ExportRecord`, or null when the shape is off. */
export function toExportRecord(raw: unknown): ExportRecord | null {
  if (!isRecord(raw)) return null
  const { id, deviceId, profile, fromMs, toMs } = raw
  if (typeof id !== 'string' || typeof deviceId !== 'number') return null
  return {
    id,
    deviceId,
    profile: typeof profile === 'string' ? profile : 'unknown',
    fromMs: typeof fromMs === 'number' ? fromMs : 0,
    toMs: typeof toMs === 'number' ? toMs : 0,
    options: toOptions(raw.options),
    state: toState(raw.state),
    progressPct: numOrNull(raw.progressPct),
    fileBytes: numOrNull(raw.fileBytes),
    expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : 0,
    deleteAfterDownload: raw.deleteAfterDownload === true,
    downloadedAt: numOrNull(raw.downloadedAt),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : '',
    error: typeof raw.error === 'string' ? raw.error : null,
  }
}

function toRecordList(raw: unknown): ExportRecord[] {
  if (!Array.isArray(raw)) return []
  const out: ExportRecord[] = []
  for (const r of raw) {
    const rec = toExportRecord(r)
    if (rec) out.push(rec)
  }
  return out
}

/** True while an export is still being produced (drives fast polling). */
export function isExportActive(rec: ExportRecord): boolean {
  return rec.state === 'queued' || rec.state === 'rendering'
}

/** Poll cadence while any export is still rendering. */
const ACTIVE_POLL_MS = 2_000

/** List exports (history included), optionally scoped to one device. Degrades to
 *  `[]` when not connected / the cap is absent. Polls fast while any row is
 *  active so progress advances without an event stream. */
export function useExportsList(deviceId?: number): UseQueryResult<ExportRecord[]> {
  const { controller, state } = useConnection()
  return useQuery<ExportRecord[]>({
    queryKey: [...EXPORTS_KEY, 'list', deviceId ?? 'all'],
    enabled: state === 'connected',
    staleTime: 5_000,
    refetchInterval: (query) =>
      (query.state.data ?? []).some(isExportActive) ? ACTIVE_POLL_MS : false,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return []
      const input: Record<string, unknown> = deviceId !== undefined ? { deviceId } : {}
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'recordingExport',
        'listExports',
        input,
      )
      const list = toRecordList(raw)
      log.info('exports', 'listExports', { deviceId: deviceId ?? null, count: list.length })
      return list
    },
  })
}

/** Fetch a single export (with live progress). Polls while active. */
export function useExport(exportId: string | null, enabled = true): UseQueryResult<ExportRecord | null> {
  const { controller, state } = useConnection()
  return useQuery<ExportRecord | null>({
    queryKey: [...EXPORTS_KEY, 'one', exportId ?? ''],
    enabled: enabled && exportId !== null && state === 'connected',
    refetchInterval: (query) => {
      const rec = query.state.data
      return rec && isExportActive(rec) ? ACTIVE_POLL_MS : false
    },
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system || exportId === null) return null
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'recordingExport',
        'getExport',
        { exportId },
      )
      return toExportRecord(raw)
    },
  })
}

/** Create an export → returns the queued record. Invalidates the list on success. */
export function useCreateExport(): UseMutationResult<ExportRecord | null, Error, CreateExportInput> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<ExportRecord | null, Error, CreateExportInput>({
    mutationFn: async (input) => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw = await capMutate(
        system.trpcClient as Record<string, unknown>,
        'recordingExport',
        'createExport',
        { ...input },
      )
      return toExportRecord(raw)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EXPORTS_KEY })
    },
  })
}

/** Cancel a queued/rendering export. */
export function useCancelExport(): UseMutationResult<ExportRecord | null, Error, string> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<ExportRecord | null, Error, string>({
    mutationFn: async (exportId) => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw = await capMutate(
        system.trpcClient as Record<string, unknown>,
        'recordingExport',
        'cancelExport',
        { exportId },
      )
      return toExportRecord(raw)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EXPORTS_KEY })
    },
  })
}

/** Delete the file (keeps the history row → state 'deleted'). */
export function useDeleteExport(): UseMutationResult<ExportRecord | null, Error, string> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<ExportRecord | null, Error, string>({
    mutationFn: async (exportId) => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw = await capMutate(
        system.trpcClient as Record<string, unknown>,
        'recordingExport',
        'deleteExport',
        { exportId },
      )
      return toExportRecord(raw)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EXPORTS_KEY })
    },
  })
}

/** Resolve an absolute download URL for an export, attaching the base URL when
 *  the cap returns a relative path. Returns null when unavailable. */
export function useResolveDownloadUrl(): (exportId: string) => Promise<string | null> {
  const { controller } = useConnection()
  return useCallback(
    async (exportId: string): Promise<string | null> => {
      const system = controller.getSystem()
      if (!system) return null
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'recordingExport',
        'getDownloadUrl',
        { exportId },
      )
      if (!isRecord(raw) || typeof raw.url !== 'string' || raw.url.length === 0) return null
      const url = raw.url
      if (url.startsWith('http://') || url.startsWith('https://')) return url
      const base = system.serverUrl.replace(/\/$/, '')
      return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`
    },
    [controller],
  )
}

/** Live-progress overlay: `id → { progressPct, state }` fed by the
 *  `recording.export.*` events. Merged over the polled list so a rendering row
 *  advances between polls. Completed/failed events invalidate the list. */
export function useExportEvents(): Record<string, { progressPct: number | null; state: ExportState }> {
  const { controller, state: connState } = useConnection()
  const queryClient = useQueryClient()
  const [live, setLive] = useState<Record<string, { progressPct: number | null; state: ExportState }>>({})

  useEffect(() => {
    // Not connected: nothing to subscribe to. `live` is cleared by the previous
    // run's cleanup on the connected→disconnected transition (and starts empty),
    // so no synchronous reset is needed here.
    if (connState !== 'connected') return
    const system = controller.getSystem()
    if (!system) return

    const readId = (e: unknown): string | null => {
      if (!isRecord(e)) return null
      if (typeof e.exportId === 'string') return e.exportId
      if (typeof e.id === 'string') return e.id
      return null
    }

    const onProgress = (event: unknown): void => {
      const id = readId(event)
      if (id === null) return
      const pct = isRecord(event) && typeof event.progressPct === 'number' ? event.progressPct : null
      setLive((prev) => ({ ...prev, [id]: { progressPct: pct, state: 'rendering' } }))
    }
    const onDone = (state: ExportState) => (event: unknown): void => {
      const id = readId(event)
      if (id !== null) setLive((prev) => ({ ...prev, [id]: { progressPct: null, state } }))
      void queryClient.invalidateQueries({ queryKey: EXPORTS_KEY })
    }

    const unsubs = [
      system.subscribeEvent('recording.export.progress', onProgress),
      system.subscribeEvent('recording.export.completed', onDone('ready')),
      system.subscribeEvent('recording.export.failed', onDone('failed')),
    ]
    return () => {
      for (const u of unsubs) u()
      setLive({})
    }
  }, [controller, connState, queryClient])

  return live
}
