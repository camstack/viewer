/**
 * A review page's (People, Plates) filter and sort, remembered on this device
 * (`store/library-filters.ts`): status, cameras and the sort persist per page;
 * the picked day is held for this visit only and every visit opens on all
 * dates. A remembered camera that is no longer on the hub is dropped.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useKnownCameraIds, useLibraryFilter } from '../../hooks/use-library-filter.js'
import {
  parseReviewRemembered,
  pruneReviewRemembered,
  type ReviewRemembered,
} from '../../store/library-filters.js'
import type { FaceReviewFilterState, FaceReviewSort } from '../../data/face-review-filters.js'

export type ReviewFiltersPage = 'faces' | 'plates'

/** The part of the filters that lives only for this visit. */
interface ReviewSessionFilters {
  readonly dayMs: number | null
  readonly subjects: readonly string[]
}

const NO_SESSION_FILTERS: ReviewSessionFilters = { dayMs: null, subjects: [] }

export interface ReviewFiltersState {
  readonly filters: FaceReviewFilterState
  readonly setFilters: (update: (prev: FaceReviewFilterState) => FaceReviewFilterState) => void
  readonly sort: FaceReviewSort
  readonly setSort: (update: (prev: FaceReviewSort) => FaceReviewSort) => void
  /** The remembered state has been read (the page holds its query until then). */
  readonly hydrated: boolean
}

export function useReviewFilters(page: ReviewFiltersPage): ReviewFiltersState {
  const knownCameras = useKnownCameraIds()
  const prune = useCallback((value: ReviewRemembered) => pruneReviewRemembered(value, knownCameras), [knownCameras])
  const remembered = useLibraryFilter(page, parseReviewRemembered, prune)
  const { set: remember } = remembered

  // The day lives in this visit only; a ref mirrors it so an updater always
  // sees the latest one, even two updates within one render.
  // The day and the picked subjects are this visit's: neither is remembered.
  const [session, setSession] = useState<ReviewSessionFilters>(NO_SESSION_FILTERS)
  const sessionRef = useRef<ReviewSessionFilters>(NO_SESSION_FILTERS)

  const { statuses, deviceIds, sort } = remembered.value
  const { dayMs, subjects } = session
  const filters = useMemo<FaceReviewFilterState>(
    () => ({ statuses, deviceIds, dayMs, subjects }),
    [statuses, deviceIds, dayMs, subjects],
  )

  const setFilters = useCallback(
    (update: (prev: FaceReviewFilterState) => FaceReviewFilterState) => {
      let nextSession = sessionRef.current
      remember((prev) => {
        const next = update({ statuses: prev.statuses, deviceIds: prev.deviceIds, ...sessionRef.current })
        nextSession = { dayMs: next.dayMs, subjects: next.subjects ?? [] }
        return { ...prev, statuses: next.statuses, deviceIds: next.deviceIds }
      })
      sessionRef.current = nextSession
      setSession(nextSession)
    },
    [remember],
  )
  const setSort = useCallback(
    (update: (prev: FaceReviewSort) => FaceReviewSort) => remember((prev) => ({ ...prev, sort: update(prev.sort) })),
    [remember],
  )

  return { filters, setFilters, sort, setSort, hydrated: remembered.hydrated }
}
