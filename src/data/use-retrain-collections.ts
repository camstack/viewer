/**
 * Named training collections — admin-only collect-and-list from theater
 * playback (`docs/design/named-training-collections.md`, D793).
 *
 * The hub already owns create / list / add-from-recording on
 * `pipelineAnalytics`. This module is the viewer's door: parse at the
 * boundary, never trust a raw mutate answer, and leave curation (boxes) on
 * the admin Training Frames tab.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'

import { useConnection } from '../connection/ConnectionProvider.js'
import { useServer } from '../app/ServerProvider.js'
import { sessionDiscriminator } from '../app/session-key.js'
import { capMutateOrThrow, capQuery, isRecord } from './cap-query.js'
import { useHasFeature } from './use-me.js'

export interface RetrainCollectionRow {
  readonly id: string
  readonly name: string
  readonly createdAt: number
  readonly frameCount: number
}

export type TrainingFrameRefusal =
  | 'unknown-collection'
  | 'still-unavailable'
  | 'still-busy'
  | 'unreadable-image'
  | 'write-failed'

export type CreateRetrainCollectionOutcome =
  | { readonly kind: 'created'; readonly collection: RetrainCollectionRow }
  | { readonly kind: 'refused'; readonly reason: 'empty-name' | 'duplicate-name' }

export type AddFrameFromRecordingOutcome =
  | { readonly kind: 'added'; readonly collectionId: string; readonly reused: boolean }
  | { readonly kind: 'refused'; readonly reason: TrainingFrameRefusal; readonly detail?: string }

function isTrainingFrameRefusal(value: string): value is TrainingFrameRefusal {
  return (
    value === 'unknown-collection' ||
    value === 'still-unavailable' ||
    value === 'still-busy' ||
    value === 'unreadable-image' ||
    value === 'write-failed'
  )
}

export function toRetrainCollection(raw: unknown): RetrainCollectionRow | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (typeof raw.name !== 'string') return null
  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return null
  if (typeof raw.frameCount !== 'number' || !Number.isFinite(raw.frameCount)) return null
  return {
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    frameCount: Math.trunc(raw.frameCount),
  }
}

export function toRetrainCollectionList(raw: unknown): readonly RetrainCollectionRow[] {
  if (!Array.isArray(raw)) return []
  const out: RetrainCollectionRow[] = []
  for (const row of raw) {
    const parsed = toRetrainCollection(row)
    if (parsed !== null) out.push(parsed)
  }
  return out
}

export function toCreateRetrainCollectionOutcome(
  raw: unknown,
): CreateRetrainCollectionOutcome | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') return null
  if (raw.kind === 'created') {
    const collection = toRetrainCollection(raw.collection)
    return collection === null ? null : { kind: 'created', collection }
  }
  if (raw.kind === 'refused') {
    if (raw.reason !== 'empty-name' && raw.reason !== 'duplicate-name') return null
    return { kind: 'refused', reason: raw.reason }
  }
  return null
}

export function toAddFrameFromRecordingOutcome(raw: unknown): AddFrameFromRecordingOutcome | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') return null
  if (raw.kind === 'added') {
    if (typeof raw.collectionId !== 'string' || typeof raw.reused !== 'boolean') return null
    return { kind: 'added', collectionId: raw.collectionId, reused: raw.reused }
  }
  if (raw.kind === 'refused') {
    if (typeof raw.reason !== 'string' || !isTrainingFrameRefusal(raw.reason)) return null
    return {
      kind: 'refused',
      reason: raw.reason,
      ...(typeof raw.detail === 'string' ? { detail: raw.detail } : {}),
    }
  }
  return null
}

/** The locale key of each named hub refusal. */
export const TRAINING_FRAME_REFUSAL_KEY: Readonly<Record<TrainingFrameRefusal, string>> = {
  'unknown-collection': 'v2.retrain.frameRefusal.unknownCollection',
  'still-unavailable': 'v2.retrain.frameRefusal.stillUnavailable',
  'still-busy': 'v2.retrain.frameRefusal.stillBusy',
  'unreadable-image': 'v2.retrain.frameRefusal.unreadableImage',
  'write-failed': 'v2.retrain.frameRefusal.writeFailed',
}

/** Operator-facing sentence for a named hub refusal, with the hub's detail when it sent one. */
export function trainingFrameRefusalText(t: TFunction, reason: TrainingFrameRefusal, detail?: string): string {
  const text = t(TRAINING_FRAME_REFUSAL_KEY[reason])
  return detail !== undefined && detail !== '' ? t('v2.retrain.frameRefusal.withDetail', { text, detail }) : text
}

export function retrainCollectionsQueryKey(
  serverUrl: string | null,
  token: string | null,
): readonly unknown[] {
  return ['v2', 'retrain-collections', serverUrl, sessionDiscriminator(token)]
}

/** Only with the `retrain` feature (an admin holds it); disabled (and empty) for everyone else. */
export function useRetrainCollections() {
  const canRetrain = useHasFeature('retrain')
  const { controller, state } = useConnection()
  const { server, sessionToken } = useServer()
  return useQuery({
    queryKey: retrainCollectionsQueryKey(server?.serverUrl ?? null, sessionToken),
    enabled: canRetrain && state === 'connected',
    staleTime: 30_000,
    queryFn: async (): Promise<readonly RetrainCollectionRow[]> => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'pipelineAnalytics',
        'listRetrainCollections',
        {},
        { rethrow: true, deadlineMs: 15_000 },
      )
      if (raw === null) throw new Error('pipelineAnalytics.listRetrainCollections is not available')
      return toRetrainCollectionList(raw)
    },
  })
}

export function useCreateRetrainCollection() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  const { server, sessionToken } = useServer()
  return useMutation({
    mutationFn: async (name: string): Promise<CreateRetrainCollectionOutcome> => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw = await capMutateOrThrow(
        system.trpcClient as unknown as Record<string, unknown>,
        'pipelineAnalytics',
        'createRetrainCollection',
        { name },
      )
      const parsed = toCreateRetrainCollectionOutcome(raw)
      if (parsed === null) throw new Error('createRetrainCollection unreadable')
      return parsed
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: retrainCollectionsQueryKey(server?.serverUrl ?? null, sessionToken),
      })
      void queryClient.invalidateQueries({ queryKey: ['v2', 'retrain-corpus-frames'] })
    },
  })
}

export interface AddFrameFromRecordingInput {
  readonly collectionId: string
  readonly deviceId: number
  readonly epochMs: number
}

export function useAddRetrainFrameFromRecording() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  const { server, sessionToken } = useServer()
  return useMutation({
    mutationFn: async (input: AddFrameFromRecordingInput): Promise<AddFrameFromRecordingOutcome> => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw = await capMutateOrThrow(
        system.trpcClient as unknown as Record<string, unknown>,
        'pipelineAnalytics',
        'addRetrainFrameFromRecording',
        {
          collectionId: input.collectionId,
          deviceId: input.deviceId,
          epochMs: input.epochMs,
        },
      )
      const parsed = toAddFrameFromRecordingOutcome(raw)
      if (parsed === null) throw new Error('addRetrainFrameFromRecording unreadable')
      return parsed
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: retrainCollectionsQueryKey(server?.serverUrl ?? null, sessionToken),
      })
    },
  })
}
