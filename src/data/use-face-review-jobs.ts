/**
 * useFaceReviewJobs — queue the People page's long actions on the Activity
 * centre's local queue.
 *
 * The page (and the Similar-groups modal) call these and return at once: the
 * work runs after whatever was queued before it, reports its progress in the
 * Activity centre, and keeps running if the operator leaves the page. Writes go
 * through the same mutations the page always used, so their cache invalidation
 * is unchanged.
 */
import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { useActivityStore } from '../activity/activity-instance.js'
import { settleAfter, type OnSettled } from '../activity/settle-after.js'
import type { FaceJobPorts, RescoreTarget } from './face-review-jobs.js'
import {
  analyzeAssignJob,
  applySuggestionsJob,
  assignJob,
  deleteFacesJob,
  rescoreJob,
} from './face-review-jobs.js'
import type { AnalyzeAssignPlanEntry } from './face-cluster-review.js'
import type { SuggestionAssignEntry } from './face-review-suggestions.js'
import { invalidateFaceAssignmentQueriesNow } from './face-query-keys.js'
import { useAssignFaces, useCreateIdentity } from './use-face-gallery.js'
import { useDeleteFaces } from './use-face-deletion.js'
import { useFaceRescore, useFaceRescoreClient } from './use-face-rescore.js'

export interface FaceReviewJobs {
  /** Recompute every suggestion; `fallbackRows` serve a hub without `face.rescoreAll`. */
  readonly recompute: (fallbackRows: readonly RescoreTarget[]) => void
  /** Follow a hub-side recompute that is already running (the tab was reopened). */
  readonly followRunningRecompute: () => void
  readonly assign: (faceIds: readonly string[], identityId: string, name: string, settled?: OnSettled) => void
  readonly assignToNewPerson: (faceIds: readonly string[], name: string, settled?: OnSettled) => void
  readonly applySuggestions: (plan: readonly SuggestionAssignEntry[], settled?: OnSettled) => void
  readonly analyzeAssign: (plan: readonly AnalyzeAssignPlanEntry[]) => void
  readonly deleteFaces: (faceIds: readonly string[], settled?: OnSettled) => void
}

export function useFaceReviewJobs(): FaceReviewJobs {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const enqueue = useActivityStore((s) => s.enqueue)
  const assignFaces = useAssignFaces()
  const createIdentity = useCreateIdentity()
  const removeFaces = useDeleteFaces()
  const rescore = useFaceRescore()
  const getRescoreClient = useFaceRescoreClient()

  const ports = useMemo<FaceJobPorts>(
    () => ({
      assign: ({ faceIds, identityId, defer }) =>
        assignFaces.mutateAsync({ faceIds: [...faceIds], identityId, deferInvalidation: defer }),
      createPerson: (name) => createIdentity.mutateAsync({ name }),
      deleteFaces: (faceIds) => removeFaces.mutateAsync({ faceIds: [...faceIds] }),
      flush: () => invalidateFaceAssignmentQueriesNow(queryClient),
      rescoreClient: getRescoreClient,
      rescoreTrack: async (row) => {
        await rescore.mutateAsync({ deviceId: row.deviceId, trackId: row.trackId })
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    }),
    [assignFaces, createIdentity, removeFaces, queryClient, getRescoreClient, rescore],
  )

  return useMemo<FaceReviewJobs>(
    () => ({
      recompute: (fallbackRows) => {
        enqueue(rescoreJob(ports, t, { start: true, fallbackRows }))
      },
      followRunningRecompute: () => {
        enqueue(rescoreJob(ports, t, { start: false, fallbackRows: [] }))
      },
      assign: (faceIds, identityId, name, settled) => {
        enqueue(settleAfter(assignJob(ports, t, { faceIds, target: { identityId, name } }), settled))
      },
      assignToNewPerson: (faceIds, name, settled) => {
        enqueue(settleAfter(assignJob(ports, t, { faceIds, target: { newName: name } }), settled))
      },
      applySuggestions: (plan, settled) => {
        enqueue(settleAfter(applySuggestionsJob(ports, t, plan), settled))
      },
      analyzeAssign: (plan) => {
        enqueue(analyzeAssignJob(ports, t, plan))
      },
      deleteFaces: (faceIds, settled) => {
        enqueue(settleAfter(deleteFacesJob(ports, t, faceIds), settled))
      },
    }),
    [enqueue, ports, t],
  )
}
