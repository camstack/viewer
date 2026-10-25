/**
 * useOpenTrack — the open/close state of a track detail, for a surface that
 * shows tracks as rows (the events gallery, the reel).
 *
 * A tap opens the detail IMMEDIATELY from the row it already holds
 * (`trackSummaryFromRow`) — a valid tap must never look dropped because a
 * round trip is pending — and the full `getTrack` row upgrades it when it
 * resolves. That upgrade is where the operator flags live: the slim feed row
 * carries them, but a write made a moment ago reaches the cached `getTrack` row
 * first (`useSetTrackFlags` publishes into it).
 *
 * ## The upgrade is DERIVED, not delivered
 *
 * `selected` is the opened summary merged with whatever `useTrackById` holds for
 * that same track, recomputed on every render. There is no "deliver once"
 * effect to forget to re-arm: re-opening the SAME track inside the cache's
 * freshness window changes no id and no cached identity, and the flag the
 * operator set a moment ago ("I add a flag, close, reopen — it is not there; it
 * appears if I toggle another flag") is simply read from the cache again. And a
 * late answer about a PREVIOUS track can never drag the operator back: it is
 * ignored unless its id is the one on screen.
 */
import { useCallback, useMemo, useState } from 'react'
import { useTrackById } from '../data/use-track-by-id.js'
import { trackSummaryFromRow, type TrackSummary } from '../data/track-events.js'
import type { EventsTrackRow } from '../../shared/events/events-track-row.js'

/** Why a detail was opened — see `TrackDetailViewProps.openIntent`. */
export type OpenIntent = 'assign-face'

export interface OpenTrack {
  readonly selected: TrackSummary | null
  readonly intent: OpenIntent | undefined
  /** Open a gallery row. `intent` belongs to THIS opening only. */
  readonly open: (row: EventsTrackRow, intent?: OpenIntent) => void
  /** Replace the shown track in place (prev/next, a deep link). Clears the intent. */
  readonly select: (track: TrackSummary) => void
  readonly close: () => void
}

export function useOpenTrack(): OpenTrack {
  const [opened, setOpened] = useState<TrackSummary | null>(null)
  const [intent, setIntent] = useState<OpenIntent | undefined>(undefined)

  const { track: resolved } = useTrackById(opened?.deviceId ?? null, opened?.trackId ?? null, '')
  const selected = useMemo<TrackSummary | null>(
    () =>
      opened !== null && resolved !== null && resolved.trackId === opened.trackId
        ? { ...resolved, cameraName: opened.cameraName }
        : opened,
    [opened, resolved],
  )

  const open = useCallback((row: EventsTrackRow, nextIntent?: OpenIntent): void => {
    setIntent(nextIntent)
    setOpened(trackSummaryFromRow(row))
  }, [])
  const select = useCallback((track: TrackSummary): void => {
    setIntent(undefined)
    setOpened(track)
  }, [])
  const close = useCallback((): void => {
    setIntent(undefined)
    setOpened(null)
  }, [])

  return { selected, intent, open, select, close }
}
