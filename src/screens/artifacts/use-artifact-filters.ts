/**
 * The Media gallery's filter state: the kinds and cameras are remembered on
 * this device (`store/library-filters.ts`), the day cursor is held for this
 * visit only and every visit opens on today. A remembered camera that is no
 * longer on the hub is dropped.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useKnownCameraIds, useLibraryFilter } from '../../hooks/use-library-filter.js'
import {
  parseArtifactsRemembered,
  pruneArtifactsRemembered,
  type ArtifactsRemembered,
} from '../../store/library-filters.js'
import { EMPTY_ARTIFACT_FILTERS, type ArtifactFilterState } from './artifact-filters.js'

export interface ArtifactFiltersState {
  readonly filterState: ArtifactFilterState
  readonly setFilterState: (update: (prev: ArtifactFilterState) => ArtifactFilterState) => void
  /** Back to the unfiltered gallery on today, and nothing remembered. */
  readonly clear: () => void
  readonly hydrated: boolean
}

export function useArtifactFilters(): ArtifactFiltersState {
  const knownCameras = useKnownCameraIds()
  const prune = useCallback((value: ArtifactsRemembered) => pruneArtifactsRemembered(value, knownCameras), [knownCameras])
  const remembered = useLibraryFilter('artifacts', parseArtifactsRemembered, prune)
  const { set: remember, clear: forget } = remembered

  const [dayOffset, setDayOffset] = useState(EMPTY_ARTIFACT_FILTERS.dayOffset)
  const dayRef = useRef(EMPTY_ARTIFACT_FILTERS.dayOffset)

  const { kinds, deviceIds } = remembered.value
  const filterState = useMemo<ArtifactFilterState>(() => ({ kinds, deviceIds, dayOffset }), [kinds, deviceIds, dayOffset])

  const setFilterState = useCallback(
    (update: (prev: ArtifactFilterState) => ArtifactFilterState) => {
      let nextDay = dayRef.current
      remember((prev) => {
        const next = update({ kinds: prev.kinds, deviceIds: prev.deviceIds, dayOffset: dayRef.current })
        nextDay = next.dayOffset
        return { kinds: next.kinds, deviceIds: next.deviceIds }
      })
      dayRef.current = nextDay
      setDayOffset(nextDay)
    },
    [remember],
  )
  const clear = useCallback(() => {
    forget()
    dayRef.current = EMPTY_ARTIFACT_FILTERS.dayOffset
    setDayOffset(EMPTY_ARTIFACT_FILTERS.dayOffset)
  }, [forget])

  return { filterState, setFilterState, clear, hydrated: remembered.hydrated }
}
