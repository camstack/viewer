/**
 * use-timeline-filter — the per-camera activity filter, and the event-kind
 * taxonomy it reads its vocabulary from.
 *
 * The two are one concern: a chip is a MACRO of the taxonomy, and a stored
 * selection is only meaningful against it. Splitting them would put the
 * `classToMacro` map on one side of a boundary and the set it collapses on the
 * other, which is how a filter panel ends up showing raw class names.
 *
 * The selection is kept PER CAMERA in the camera-local store, in MEMORY only
 * (an ephemeral field: a new launch shows everything), where ABSENCE means
 * "all".
 *
 * The single-item toggles deliberately do NOT compute the next set here. They
 * forward the tapped id to a store reducer that resolves the LATEST stored
 * selection, because a render-time closure over the current set loses taps: two
 * pills pressed inside one frame both write from the same stale base, and the
 * second erases the first.
 */
import { useCallback, useEffect, useMemo } from 'react'

import {
  ALL_BAR_KINDS,
  isFilterAll,
  type ActivityFilter,
  type TimelineBarKind,
} from './mock-data.js'
import { useEventKinds } from '../../../data/use-event-kinds.js'
import { classToMacroMap, type EventKindDescriptor } from '../../../data/event-kinds.js'
import { useCameraPrefsStore } from '../../../store/camera-prefs-store.js'
import { useCameraLocalStore } from '../../../store/camera-local-store.js'
import { withHighlightDefaults, type GridHighlightSettings } from '../../../store/grid-store.js'

export interface TimelineFilterState {
  /** The selected motion/audio kinds (a full set ⟺ "all"). */
  readonly filter: ActivityFilter
  /** Selected detection classes — an EMPTY set means "all classes". */
  readonly classFilter: ReadonlySet<string>
  /** True when the operator has narrowed anything (lights the footer chip). */
  readonly filterActive: boolean
  /** True when no kind has been deselected — the fast path for the lanes. */
  readonly filterAll: boolean
  /** Class → taxonomy macro, for collapsing the open detection vocabulary. */
  readonly classToMacro: ReadonlyMap<string, string>
  /** The hub's per-camera event-kind taxonomy. `undefined` means the query has
   *  NOT settled yet — consumers must render a loading state then, never the
   *  fallback (defaulting it to `[]` was the cold-open-shows-the-lesser-list
   *  regression of 2026-08-01). */
  readonly eventKinds?: readonly EventKindDescriptor[]
  /** Cluster label mode (icon vs text) — the per-camera highlight pref. */
  readonly clusterLabelMode: GridHighlightSettings['clusterLabel']
  readonly onToggleKind: (kind: TimelineBarKind) => void
  readonly onToggleClass: (className: string) => void
  /** Replace the whole selection — the taxonomy tree's macro select/deselect
   *  sets many classes at once, and doing it as N toggles would write the
   *  store N times and race itself. */
  readonly onSetClasses: (classes: readonly string[]) => void
  readonly onReset: () => void
}

export function useTimelineFilter(
  deviceId: number,
  kindDeviceIds?: readonly number[],
): TimelineFilterState {
  // The filter is EPHEMERAL (camera-local, memory only): narrowing the
  // timeline is an investigation, not a preference. The cluster label mode
  // rides the camera's highlight, an account setting (camera-prefs).
  const storedTimelineKinds = useCameraLocalStore((s) => s.local.byId[deviceId]?.timelineKinds)
  const storedTimelineClasses = useCameraLocalStore((s) => s.local.byId[deviceId]?.timelineClasses)
  const storedHighlight = useCameraPrefsStore((s) => s.prefs.byId[deviceId]?.highlight)
  const setCameraTimelineKinds = useCameraLocalStore((s) => s.setCameraTimelineKinds)
  const setCameraTimelineClasses = useCameraLocalStore((s) => s.setCameraTimelineClasses)
  const toggleCameraTimelineKind = useCameraLocalStore((s) => s.toggleCameraTimelineKind)
  const toggleCameraTimelineClass = useCameraLocalStore((s) => s.toggleCameraTimelineClass)
  const hydratePrefs = useCameraPrefsStore((s) => s.hydrate)
  const hydrateLocal = useCameraLocalStore((s) => s.hydrate)

  useEffect(() => {
    void hydratePrefs()
    void hydrateLocal()
  }, [hydratePrefs, hydrateLocal])

  const filter = useMemo<ActivityFilter>(
    () => new Set<TimelineBarKind>(storedTimelineKinds ?? ALL_BAR_KINDS),
    [storedTimelineKinds],
  )
  const classFilter = useMemo<ReadonlySet<string>>(
    () => new Set<string>(storedTimelineClasses ?? []),
    [storedTimelineClasses],
  )
  const filterAll = isFilterAll(filter)
  const filterActive = !filterAll || classFilter.size > 0

  const eventKinds = useEventKinds(kindDeviceIds ?? [deviceId])
  const classToMacro = useMemo(() => classToMacroMap(eventKinds.data ?? []), [eventKinds.data])

  const clusterLabelMode = useMemo(
    () => withHighlightDefaults(storedHighlight).clusterLabel,
    [storedHighlight],
  )

  const onReset = useCallback(() => {
    setCameraTimelineKinds(deviceId, [...ALL_BAR_KINDS])
    setCameraTimelineClasses(deviceId, [])
  }, [setCameraTimelineKinds, setCameraTimelineClasses, deviceId])

  const onToggleKind = useCallback(
    (kind: TimelineBarKind) => toggleCameraTimelineKind(deviceId, kind),
    [toggleCameraTimelineKind, deviceId],
  )
  const onSetClasses = useCallback(
    (classes: readonly string[]) => setCameraTimelineClasses(deviceId, classes),
    [setCameraTimelineClasses, deviceId],
  )
  const onToggleClass = useCallback(
    (className: string) => toggleCameraTimelineClass(deviceId, className),
    [toggleCameraTimelineClass, deviceId],
  )

  return {
    filter,
    classFilter,
    filterActive,
    filterAll,
    classToMacro,
    eventKinds: eventKinds.data,
    clusterLabelMode,
    onToggleKind,
    onToggleClass,
    onSetClasses,
    onReset,
  }
}
