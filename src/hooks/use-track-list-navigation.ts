/**
 * useTrackListNavigation — prev/next for a detail opened over an ORDERED track
 * collection the screen shows (the gallery's or the reel's rows).
 *
 * The screen owns the selection; this hook owns only the moves. A move opens
 * the neighbour IMMEDIATELY from its list entry (same "never let latency eat a
 * tap" rule as a card click — see `trackSummaryFromRow`) and then
 * upgrades it in place once `getTrack` resolves the full row, exactly the way
 * `useOpenTrack` enriches a click. The neighbour maths is the shared
 * pure planner (`planTrackNavigation`), so every surface advances the same way.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { planTrackNavigation, type TrackDetailNavigation } from '../data/track-navigation.js'
import { useTrackById } from '../data/use-track-by-id.js'
import { trackSummaryFromRow, type TrackSummary } from '../data/track-events.js'
import type { EventsTrackRow } from '../../shared/events/events-track-row.js'

export interface UseTrackListNavigationArgs {
  /** The collection, in DISPLAY order. */
  readonly tracks: readonly EventsTrackRow[]
  /** The track the detail currently shows (null → nothing to navigate). */
  readonly selected: TrackSummary | null
  /** deviceId → display name (client-side renames included). */
  readonly cameraNameFor: (deviceId: number) => string
  /** Replace the detail's track IN PLACE — the modal stays mounted. */
  readonly onSelect: (track: TrackSummary) => void
}

/** A navigation move whose full row is still being fetched. */
interface PendingNav {
  readonly deviceId: number
  readonly trackId: string
}

/**
 * Returns the detail navigation contract, or undefined when the selected track
 * is not in the collection (deep link, stale list) or the collection cannot be
 * moved within — the detail then simply shows no arrows.
 */
export function useTrackListNavigation({
  tracks, selected, cameraNameFor, onSelect,
}: UseTrackListNavigationArgs): TrackDetailNavigation | undefined {
  const [pending, setPending] = useState<PendingNav | null>(null)

  // Upgrade the immediately-opened list entry to the full row, but ONLY while
  // the detail still shows that track — a selection made meanwhile (another
  // card click, a deep link) must never be stomped by a late fetch.
  const { track: resolved } = useTrackById(
    pending?.deviceId ?? null,
    pending?.trackId ?? null,
    pending !== null ? cameraNameFor(pending.deviceId) : '',
  )
  useEffect(() => {
    if (pending === null || resolved === null) return
    if (resolved.trackId !== pending.trackId) return
    setPending(null)
    if (selected?.trackId === pending.trackId) onSelect(resolved)
  }, [resolved, pending, selected, onSelect])

  const ids = useMemo(() => tracks.map((entry) => entry.trackId), [tracks])
  const plan = planTrackNavigation(ids, selected?.trackId ?? null)

  const goTo = useCallback(
    (trackId: string | null): void => {
      if (trackId === null) return
      const entry = tracks.find((candidate) => candidate.trackId === trackId)
      if (entry === undefined) return
      onSelect(trackSummaryFromRow({ ...entry, cameraName: cameraNameFor(entry.deviceId) }))
      setPending({ deviceId: entry.deviceId, trackId: entry.trackId })
    },
    [tracks, cameraNameFor, onSelect],
  )

  const prevId = plan?.prevId ?? null
  const nextId = plan?.nextId ?? null
  const onPrev = useCallback((): void => goTo(prevId), [goTo, prevId])
  const onNext = useCallback((): void => goTo(nextId), [goTo, nextId])

  return useMemo<TrackDetailNavigation | undefined>(
    () =>
      plan === null
        ? undefined
        : {
            position: plan.index + 1,
            count: plan.count,
            hasPrev: plan.hasPrev,
            hasNext: plan.hasNext,
            onPrev,
            onNext,
          },
    // `plan` is re-derived every render; its FIELDS are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan?.index, plan?.count, plan?.hasPrev, plan?.hasNext, onPrev, onNext],
  )
}
