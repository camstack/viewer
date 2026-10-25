/**
 * use-retrain — hub-facing hooks for the admin-only Library Retrain tab.
 *
 * Mirrors `use-face-review.ts`: TanStack Query over defensive `capQuery` /
 * `capMutateOrThrow`, with `rethrow: true` on list reads so an unreadable
 * worklist surfaces as `isError` rather than an empty success.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  RetrainAnnotation,
  RetrainAnnotationDraft,
  RetrainDismissed,
  RetrainFrame,
  RetrainFrameList,
  RetrainTrack,
} from '@camstack/types'
import { useConnection } from '../connection/ConnectionProvider.js'
import { BULK_QUERY_DEADLINE_MS, capMutateOrThrow, capQuery } from './cap-query.js'
import { RETRAIN_CORPUS_QUERY_KEY } from './use-retrain-corpus.js'
import {
  parseRetrainAnnotations,
  parseRetrainFrameImage,
  parseRetrainFrameList,
  parseRetrainFrameSelection,
  parseRetrainStaging,
  type RetrainFrameImage,
} from './retrain-parse.js'

export const RETRAIN_STAGING_QUERY_KEY = 'retrain-staging'
export const RETRAIN_FRAMES_QUERY_KEY = 'retrain-frames'
export const RETRAIN_ANNOTATIONS_QUERY_KEY = 'retrain-annotations'
export const RETRAIN_FRAME_IMAGE_QUERY_KEY = 'retrain-frame-image'

interface TrpcHost {
  getSystem(): { trpcClient: unknown } | null
}

function trpcClient(controller: TrpcHost): Record<string, unknown> | null {
  const system = controller.getSystem()
  if (!system) return null
  return system.trpcClient as Record<string, unknown>
}

export function useRetrainStaging(enabled: boolean) {
  const { controller, state } = useConnection()
  return useQuery<readonly RetrainTrack[]>({
    queryKey: ['v2', RETRAIN_STAGING_QUERY_KEY],
    enabled: enabled && state === 'connected',
    staleTime: 30_000,
    queryFn: async () => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      const raw = await capQuery(client, 'pipelineAnalytics', 'listRetrainStaging', { limit: 200 }, {
        deadlineMs: BULK_QUERY_DEADLINE_MS,
        rethrow: true,
      })
      const parsed = parseRetrainStaging(raw)
      if (parsed === undefined) throw new Error('unparseable staging list')
      return parsed
    },
  })
}

export function useRetrainFrames(trackId: string | null, enabled: boolean) {
  const { controller, state } = useConnection()
  const id = trackId ?? ''
  return useQuery<RetrainFrameList>({
    queryKey: ['v2', RETRAIN_FRAMES_QUERY_KEY, id],
    enabled: enabled && state === 'connected' && id.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      const raw = await capQuery(client, 'pipelineAnalytics', 'listRetrainFrames', { trackId: id }, {
        deadlineMs: BULK_QUERY_DEADLINE_MS,
        rethrow: true,
      })
      const parsed = parseRetrainFrameList(raw)
      if (parsed === undefined) throw new Error('unparseable frame list')
      return parsed
    },
  })
}

export function useRetrainFrameImage(frameId: string | null, enabled: boolean) {
  const { controller, state } = useConnection()
  const id = frameId ?? ''
  return useQuery<RetrainFrameImage>({
    queryKey: ['v2', RETRAIN_FRAME_IMAGE_QUERY_KEY, id],
    enabled: enabled && state === 'connected' && id.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      const raw = await capQuery(client, 'pipelineAnalytics', 'getRetrainFrameImage', { frameId: id }, {
        deadlineMs: BULK_QUERY_DEADLINE_MS,
        rethrow: true,
      })
      const parsed = parseRetrainFrameImage(raw)
      if (parsed === undefined) throw new Error('unparseable frame image')
      return parsed
    },
  })
}

export function useRetrainAnnotations(frameId: string | null, trackId: string | null, enabled: boolean) {
  const { controller, state } = useConnection()
  const frame = frameId ?? ''
  const track = trackId ?? ''
  return useQuery<readonly RetrainAnnotation[]>({
    queryKey: ['v2', RETRAIN_ANNOTATIONS_QUERY_KEY, track, frame],
    enabled: enabled && state === 'connected' && frame.length > 0,
    staleTime: 10_000,
    queryFn: async () => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      const raw = await capQuery(
        client,
        'pipelineAnalytics',
        'listRetrainAnnotations',
        track.length > 0 ? { trackId: track, frameIds: [frame] } : { frameIds: [frame] },
        { deadlineMs: BULK_QUERY_DEADLINE_MS, rethrow: true },
      )
      const parsed = parseRetrainAnnotations(raw)
      if (parsed === undefined) throw new Error('unparseable annotations')
      return parsed
    },
  })
}

export interface SelectRetrainFramesInput {
  readonly deviceId: number
  readonly trackId: string
  readonly mediaIds: readonly number[]
}

export function useSelectRetrainFrames() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SelectRetrainFramesInput): Promise<readonly RetrainFrame[]> => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      const raw = await capMutateOrThrow(client, 'pipelineAnalytics', 'selectRetrainFrames', {
        deviceId: input.deviceId,
        trackId: input.trackId,
        mediaIds: [...input.mediaIds],
      })
      const parsed = parseRetrainFrameSelection(raw)
      if (parsed === undefined) throw new Error('unparseable selection result')
      return parsed.copied
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ['v2', RETRAIN_STAGING_QUERY_KEY] })
      void queryClient.invalidateQueries({ queryKey: ['v2', RETRAIN_FRAMES_QUERY_KEY, input.trackId] })
    },
  })
}

export interface SaveRetrainAnnotationsInput {
  readonly deviceId: number
  readonly trackId?: string
  readonly frameId: string
  readonly annotations: readonly RetrainAnnotationDraft[]
  /** Every proposal the operator deleted — saved with the frame, never re-seeded. */
  readonly dismissed?: readonly RetrainDismissed[]
  /** The revision the editor was seeded from; a stale one is refused. */
  readonly expectedRevision?: number
}

export function useSaveRetrainAnnotations() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SaveRetrainAnnotationsInput): Promise<readonly RetrainAnnotation[]> => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      const raw = await capMutateOrThrow(client, 'pipelineAnalytics', 'saveRetrainAnnotations', {
        deviceId: input.deviceId,
        trackId: input.trackId,
        frameId: input.frameId,
        annotations: [...input.annotations],
        ...(input.dismissed !== undefined ? { dismissed: [...input.dismissed] } : {}),
        ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}),
      })
      const parsed = parseRetrainAnnotations(raw)
      if (parsed === undefined) throw new Error('unparseable save result')
      return parsed
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ['v2', RETRAIN_STAGING_QUERY_KEY] })
      // The corpus rows carry `revision`, `dismissed` and the saved `review`.
      void queryClient.invalidateQueries({ queryKey: ['v2', RETRAIN_CORPUS_QUERY_KEY] })
      if (input.trackId) {
        void queryClient.invalidateQueries({ queryKey: ['v2', RETRAIN_FRAMES_QUERY_KEY, input.trackId] })
      }
      void queryClient.invalidateQueries({
        queryKey: ['v2', RETRAIN_ANNOTATIONS_QUERY_KEY, input.trackId ?? '', input.frameId],
      })
    },
  })
}

export interface CompleteRetrainTrackInput {
  readonly deviceId: number
  readonly trackId: string
}

export function useCompleteRetrainTrack() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CompleteRetrainTrackInput): Promise<void> => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      await capMutateOrThrow(client, 'pipelineAnalytics', 'completeRetrainTrack', {
        deviceId: input.deviceId,
        trackId: input.trackId,
      })
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ['v2', RETRAIN_STAGING_QUERY_KEY] })
      void queryClient.invalidateQueries({ queryKey: ['v2', RETRAIN_FRAMES_QUERY_KEY, input.trackId] })
    },
  })
}

export interface SetRetrainFrameCompleteInput {
  readonly deviceId: number
  readonly trackId?: string
  readonly frameId: string
  readonly complete: boolean
}

/** "Every real subject on this frame is boxed" — the frame's completeness flag. */
export function useSetRetrainFrameComplete() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SetRetrainFrameCompleteInput): Promise<void> => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      await capMutateOrThrow(client, 'pipelineAnalytics', 'setRetrainFrameComplete', {
        deviceId: input.deviceId,
        ...(input.trackId !== undefined ? { trackId: input.trackId } : {}),
        frameId: input.frameId,
        complete: input.complete,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v2', RETRAIN_CORPUS_QUERY_KEY] })
    },
  })
}

/** The most frames whose annotations feed the label suggestions. */
export const RETRAIN_VOCABULARY_FRAME_LIMIT = 200

/**
 * The corpus vocabulary the label field suggests from: the annotations of the
 * frames the list already holds. No server method of its own.
 */
export function useRetrainVocabularySource(frameIds: readonly string[], enabled: boolean) {
  const { controller, state } = useConnection()
  const ids = frameIds.slice(0, RETRAIN_VOCABULARY_FRAME_LIMIT)
  return useQuery<readonly RetrainAnnotation[]>({
    queryKey: ['v2', RETRAIN_ANNOTATIONS_QUERY_KEY, 'vocabulary', ids.join(',')],
    enabled: enabled && state === 'connected' && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      const raw = await capQuery(
        client,
        'pipelineAnalytics',
        'listRetrainAnnotations',
        { frameIds: [...ids] },
        { deadlineMs: BULK_QUERY_DEADLINE_MS, rethrow: true },
      )
      const parsed = parseRetrainAnnotations(raw)
      if (parsed === undefined) throw new Error('unparseable annotations')
      return parsed
    },
  })
}
