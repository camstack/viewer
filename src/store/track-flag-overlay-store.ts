/**
 * Live overlay of operator flags the HOST just wrote, keyed by trackId.
 *
 * The events gallery is an embed whose feed is ordered by `lastSeen`. A flag
 * write does not move that clock, so the incremental poll never replaces the
 * card. This store is the copy the host pushes into the embed so the D/T/★
 * pills and the debug/train/favourite chips see the write without a refetch.
 * Not persisted: after a remount the hub row is the source of truth.
 */
import { create } from 'zustand'

export interface TrackFlagOverlay {
  readonly debug: boolean
  readonly markForTrain: boolean
  readonly favourited: boolean
}

interface TrackFlagOverlayState {
  readonly patches: Readonly<Record<string, TrackFlagOverlay>>
  apply: (trackId: string, flags: TrackFlagOverlay) => void
}

export const useTrackFlagOverlayStore = create<TrackFlagOverlayState>((set) => ({
  patches: {},
  apply: (trackId, flags) => {
    if (trackId.length === 0) return
    set((s) => ({ patches: { ...s.patches, [trackId]: flags } }))
  },
}))
