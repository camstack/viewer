/**
 * use-plate-review — hub-facing hooks for the admin-only Plates page, over the
 * `plateGallery` cap (tRPC router `plateGallery`). The twin of
 * `use-face-review.ts` / `use-face-review-jobs.ts`.
 *
 *   • `usePlateReviewData` — the grid's rows + the vehicles. One camera and the
 *     window size travel in the request (see `plate-review-filters.ts` for what
 *     the cap can and cannot narrow); "infinite scroll" grows `limit` and
 *     re-fetches the window (metadata only, `includeCrops:false`).
 *   • `usePlateClusters` — the look-alike groups, fetched only while the
 *     Similar-plates modal is open.
 *   • `usePlateReviewJobs` — every long write, queued on the Activity centre.
 *   • `useCorrectPlateText` — the one quick inline write.
 */
import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { useActivityStore } from '../activity/activity-instance.js'
import { settleAfter, type OnSettled } from '../activity/settle-after.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { log } from '../lib/logger.js'
import { BULK_QUERY_DEADLINE_MS, capMutateOrThrow, capQuery, isRecord } from './cap-query.js'
import { runWithConcurrency } from './face-cluster-review.js'
import type { FaceReviewFilterState } from './face-review-filters.js'
import { useCameras } from './use-cameras.js'
import {
  buildPlateReviewRows,
  toPlateCluster,
  toPlateInfo,
  toPlateList,
  toPlateVehicle,
  type PlateCluster,
  type PlateInfo,
  type PlateReviewRow,
  type PlateSuggestionEntry,
  type PlateVehicle,
} from './plate-review.js'
import { plateReviewListInput, type PlateReviewListInput } from './plate-review-filters.js'
import { plateApplySuggestionsJob, plateAssignJob, plateDeleteJob, type PlateJobPorts } from './plate-review-jobs.js'
import { invalidatePlateQueries, PLATE_CLUSTERS_KEY, PLATE_REVIEW_KEY, PLATE_VEHICLES_KEY } from './plate-query-keys.js'

/** Grid page size: how much `limit` grows on each `loadMore()`. */
const PLATES_PAGE_SIZE = 200
const PLATES_MAX_LIMIT = 2000
/** Similar-plates query knobs (the server's own defaults, spelled out). */
export const PLATE_CLUSTER_QUERY = { maxDistance: 1, minClusterSize: 2, limit: 100 } as const
const DELETE_CONCURRENCY = 4

type TrpcClient = Record<string, unknown>

function usePlateClient(): () => TrpcClient | null {
  const { controller } = useConnection()
  return useCallback(() => {
    const system = controller.getSystem()
    return system ? (system.trpcClient as TrpcClient) : null
  }, [controller])
}

async function fetchPlates(client: TrpcClient, input: PlateReviewListInput): Promise<PlateInfo[]> {
  const raw = await capQuery(client, 'plateGallery', 'listPlates', input, { deadlineMs: BULK_QUERY_DEADLINE_MS })
  return toPlateList(raw, toPlateInfo)
}

export function usePlateReviewPlates(enabled: boolean, filters: FaceReviewFilterState) {
  const { state } = useConnection()
  const getClient = usePlateClient()
  // The window grows per VIEW (here: the camera pushed to the hub); a new view
  // starts again at one page — derived from the signature, not reset by an effect.
  const view = JSON.stringify(plateReviewListInput(filters, 0))
  const [grown, setGrown] = useState({ view, limit: PLATES_PAGE_SIZE })
  const limit = grown.view === view ? grown.limit : PLATES_PAGE_SIZE
  const input = plateReviewListInput(filters, limit)
  const query = useQuery<PlateInfo[]>({
    queryKey: ['v2', PLATE_REVIEW_KEY, input],
    enabled: enabled && state === 'connected',
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const client = getClient()
      return client === null ? [] : fetchPlates(client, input)
    },
  })
  const loadMore = useCallback(() => {
    setGrown({ view, limit: Math.min(PLATES_MAX_LIMIT, limit + PLATES_PAGE_SIZE) })
  }, [view, limit])
  // The FEED count decides, never the filtered one: a full page came back and
  // there is room to grow. A short page means the hub has nothing more.
  const hasMore = limit < PLATES_MAX_LIMIT && (query.data?.length ?? 0) >= limit
  return { ...query, loadMore, hasMore, isFetchingMore: query.isFetching && (query.data?.length ?? 0) > 0 }
}

export function usePlateVehicles(enabled: boolean) {
  const { state } = useConnection()
  const getClient = usePlateClient()
  return useQuery<PlateVehicle[]>({
    queryKey: ['v2', PLATE_VEHICLES_KEY],
    enabled: enabled && state === 'connected',
    staleTime: 30_000,
    queryFn: async () => {
      const client = getClient()
      if (client === null) return []
      const raw = await capQuery(client, 'plateGallery', 'listVehicles', { includeCrops: false })
      return toPlateList(raw, toPlateVehicle).sort((a, b) => a.name.localeCompare(b.name))
    },
  })
}

export function usePlateClusters(enabled: boolean) {
  const { state } = useConnection()
  const getClient = usePlateClient()
  return useQuery<PlateCluster[]>({
    queryKey: ['v2', PLATE_CLUSTERS_KEY, PLATE_CLUSTER_QUERY],
    enabled: enabled && state === 'connected',
    staleTime: 30_000,
    queryFn: async () => {
      const client = getClient()
      if (client === null) return []
      const raw = await capQuery(client, 'plateGallery', 'suggestPlateClusters', PLATE_CLUSTER_QUERY, {
        deadlineMs: BULK_QUERY_DEADLINE_MS,
      })
      return toPlateList(raw, toPlateCluster)
    },
  })
}

export interface PlateReviewData {
  /** UNSORTED and UNFILTERED — the screen owns both. */
  readonly rows: readonly PlateReviewRow[]
  readonly vehicles: readonly PlateVehicle[]
  readonly isLoading: boolean
  readonly isError: boolean
  readonly refetch: () => Promise<unknown>
  readonly loadMore: () => void
  readonly hasMore: boolean
  readonly isFetchingMore: boolean
}

/** Plates + vehicles + camera names (from the app-wide `useCameras` cache) as grid rows. */
export function usePlateReviewData(enabled: boolean, filters: FaceReviewFilterState): PlateReviewData {
  const plates = usePlateReviewPlates(enabled, filters)
  const { data: cameras } = useCameras()
  const { data: vehicles = [], isLoading: vehiclesLoading, isError: vehiclesError, refetch: refetchVehicles } =
    usePlateVehicles(enabled)
  const cameraNameById = useMemo(() => new Map((cameras ?? []).map((c) => [c.id, c.name])), [cameras])
  const rows = useMemo(
    () => buildPlateReviewRows(plates.data ?? [], vehicles, cameraNameById),
    [plates.data, vehicles, cameraNameById],
  )
  const refetch = useCallback(async () => {
    await Promise.all([plates.refetch(), refetchVehicles()])
  }, [plates, refetchVehicles])
  return {
    rows,
    vehicles,
    isLoading: plates.isLoading || vehiclesLoading,
    isError: plates.isError || vehiclesError,
    refetch,
    loadMore: plates.loadMore,
    hasMore: plates.hasMore,
    isFetchingMore: plates.isFetchingMore,
  }
}

/** `{assigned, failed}` from `assignPlates`; an unreadable answer counts as nothing assigned. */
function toAssignResult(raw: unknown): { assigned: number; failed: string[] } {
  if (!isRecord(raw) || typeof raw.assigned !== 'number') return { assigned: 0, failed: [] }
  const failed = Array.isArray(raw.failed) ? raw.failed.filter((id): id is string => typeof id === 'string') : []
  return { assigned: raw.assigned, failed }
}

/** Correct one read's OCR text (marks it corrected). Quick, so inline rather than queued. */
export function useCorrectPlateText() {
  const getClient = usePlateClient()
  const queryClient = useQueryClient()
  return useMutation<void, Error, { readonly plateId: string; readonly text: string }>({
    mutationFn: async ({ plateId, text }) => {
      const client = getClient()
      if (client === null) throw new Error('plateGallery.correctPlateText: not connected')
      await capMutateOrThrow(client, 'plateGallery', 'correctPlateText', { plateId, text })
    },
    onSuccess: async () => {
      await invalidatePlateQueries(queryClient)
    },
  })
}

/** Add a vehicle with no plate in hand (the header's New vehicle). */
export function useCreateVehicle() {
  const getClient = usePlateClient()
  const queryClient = useQueryClient()
  return useMutation<PlateVehicle, Error, { readonly name: string }>({
    mutationFn: async ({ name }) => {
      const client = getClient()
      if (client === null) throw new Error('plateGallery.createVehicle: not connected')
      const vehicle = toPlateVehicle(await capMutateOrThrow(client, 'plateGallery', 'createVehicle', { name }))
      if (vehicle === null) throw new Error('plateGallery.createVehicle: unreadable answer')
      return vehicle
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2', PLATE_VEHICLES_KEY] })
    },
  })
}

export interface PlateReviewJobs {
  readonly assign: (plateIds: readonly string[], vehicleId: string, name: string, settled?: OnSettled) => void
  readonly assignToNewVehicle: (plateIds: readonly string[], name: string, settled?: OnSettled) => void
  readonly applySuggestions: (plan: readonly PlateSuggestionEntry[], settled?: OnSettled) => void
  readonly deletePlates: (plateIds: readonly string[], settled?: OnSettled) => void
}

export function usePlateReviewJobs(): PlateReviewJobs {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const enqueue = useActivityStore((s) => s.enqueue)
  const getClient = usePlateClient()

  const ports = useMemo<PlateJobPorts>(
    () => ({
      assign: async ({ plateIds, vehicleId, defer }) => {
        const client = getClient()
        if (client === null) throw new Error('plateGallery.assignPlates: not connected')
        const result = toAssignResult(
          await capMutateOrThrow(client, 'plateGallery', 'assignPlates', { plateIds: [...plateIds], vehicleId }),
        )
        if (!defer) await invalidatePlateQueries(queryClient)
        return result
      },
      createVehicle: async (name) => {
        const client = getClient()
        if (client === null) throw new Error('plateGallery.createVehicle: not connected')
        const vehicle = toPlateVehicle(await capMutateOrThrow(client, 'plateGallery', 'createVehicle', { name }))
        if (vehicle === null) throw new Error('plateGallery.createVehicle: unreadable answer')
        return vehicle
      },
      deletePlates: async (plateIds) => {
        const client = getClient()
        if (client === null) throw new Error('plateGallery.deletePlate: not connected')
        let deleted = 0
        // One call per read (the cap has no batch delete), bounded, and every
        // refusal is named — a bare "18 of 20" cannot be acted on.
        await runWithConcurrency([...plateIds], DELETE_CONCURRENCY, async (plateId) => {
          try {
            await capMutateOrThrow(client, 'plateGallery', 'deletePlate', { plateId })
            deleted += 1
          } catch (error: unknown) {
            log.warn('plate-delete', 'the hub refused to delete a plate', {
              plateId,
              error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            })
          }
        })
        await invalidatePlateQueries(queryClient)
        return { deleted }
      },
      flush: () => invalidatePlateQueries(queryClient),
    }),
    [getClient, queryClient],
  )

  return useMemo<PlateReviewJobs>(
    () => ({
      assign: (plateIds, vehicleId, name, settled) => {
        enqueue(settleAfter(plateAssignJob(ports, t, { plateIds, target: { vehicleId, name } }), settled))
      },
      assignToNewVehicle: (plateIds, name, settled) => {
        enqueue(settleAfter(plateAssignJob(ports, t, { plateIds, target: { newName: name } }), settled))
      },
      applySuggestions: (plan, settled) => {
        enqueue(settleAfter(plateApplySuggestionsJob(ports, t, plan), settled))
      },
      deletePlates: (plateIds, settled) => {
        enqueue(settleAfter(plateDeleteJob(ports, t, plateIds), settled))
      },
    }),
    [enqueue, ports, t],
  )
}
