/**
 * Persisted local map of debug lifecycle per trackId.
 *
 * `open` / `reviewed` only — `none` is the absence of a key. Hydrate once;
 * writes go to AsyncStorage the same way `events-filter-store` does.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  parseDebugStatuses,
  resolveDebugStatus,
  reuseReviewedIds,
  type DebugStatus,
} from './debug-status.js'

const STORAGE_KEY = 'camstack.v2.debug-status'

interface DebugStatusState {
  readonly statuses: Readonly<Record<string, DebugStatus>>
  /** Stable snapshot of reviewed ids — NEVER derive this in a zustand selector. */
  readonly reviewedIds: readonly string[]
  readonly hydrated: boolean
  hydrate: () => Promise<void>
  markOpen: (trackId: string) => void
  markReviewed: (trackId: string) => void
  markNone: (trackId: string) => void
  statusOf: (trackId: string, debug: boolean | undefined) => DebugStatus
}

function commit(
  statuses: Readonly<Record<string, DebugStatus>>,
): Pick<DebugStatusState, 'statuses' | 'reviewedIds'> {
  return {
    statuses,
    reviewedIds: reuseReviewedIds(useDebugStatusStore.getState().reviewedIds, statuses),
  }
}

function persist(statuses: Readonly<Record<string, DebugStatus>>): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(statuses))
}

function without(map: Readonly<Record<string, DebugStatus>>, trackId: string): Record<string, DebugStatus> {
  if (map[trackId] === undefined) return { ...map }
  const next = { ...map }
  delete next[trackId]
  return next
}

export const useDebugStatusStore = create<DebugStatusState>((set, get) => ({
  statuses: {},
  reviewedIds: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)
      const statuses = parseDebugStatuses(raw === null ? null : JSON.parse(raw))
      set({ ...commit(statuses), hydrated: true })
    } catch {
      set({ hydrated: true })
    }
  },
  markOpen: (trackId) => {
    if (trackId.length === 0) return
    const statuses = { ...get().statuses, [trackId]: 'open' as const }
    set(commit(statuses))
    persist(statuses)
  },
  markReviewed: (trackId) => {
    if (trackId.length === 0) return
    const statuses = { ...get().statuses, [trackId]: 'reviewed' as const }
    set(commit(statuses))
    persist(statuses)
  },
  markNone: (trackId) => {
    if (trackId.length === 0) return
    const statuses = without(get().statuses, trackId)
    set(commit(statuses))
    persist(statuses)
  },
  statusOf: (trackId, debug) => resolveDebugStatus(debug, get().statuses[trackId]),
}))
