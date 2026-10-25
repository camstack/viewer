/**
 * The last stream-debug sample each camera's player reported.
 *
 * ## Why a store and not a prop
 *
 * The numbers are measured inside the WebView — only the player holds the
 * `RTCPeerConnection` — and they are READ in the status-detail card, which is
 * mounted by the camera card and by the theater toolbar, neither of which is
 * on the player's prop path. Threading a sample through both hosts would mean
 * two chains that can disagree; one store keyed by device cannot.
 *
 * ## In memory, never persisted
 *
 * A sample is true for about a second. Rehydrating one from disk would put a
 * stale bitrate and a dead session id in front of an operator who opened the
 * card BEFORE the stream connected — which is the exact failure the ages in
 * the card exist to prevent. It is dropped when the player goes away.
 */
import { create } from 'zustand'
import type { StreamDebugSample } from '../live/stream-debug-sample.js'

interface StreamDebugState {
  /** Keyed by numeric deviceId. Absent = no player has reported yet. */
  readonly samples: Readonly<Record<number, StreamDebugSample>>
  report: (deviceId: number, sample: StreamDebugSample) => void
  /** Called when a player unmounts: its numbers stop being true. */
  clear: (deviceId: number) => void
  sampleOf: (deviceId: number) => StreamDebugSample | null
}

export const useStreamDebugStore = create<StreamDebugState>((set, get) => ({
  samples: {},
  report: (deviceId, sample) => {
    set((state) => ({ samples: { ...state.samples, [deviceId]: sample } }))
  },
  clear: (deviceId) => {
    set((state) => {
      if (state.samples[deviceId] === undefined) return state
      const next = { ...state.samples }
      delete next[deviceId]
      return { samples: next }
    })
  },
  sampleOf: (deviceId) => get().samples[deviceId] ?? null,
}))
