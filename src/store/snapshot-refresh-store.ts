/**
 * snapshot-refresh-store — a global "manual refresh" epoch for camera snapshots.
 *
 * A snapshot URL is versioned on the FRAME IDENTITY (`snapshotVersionTag`), so
 * an operator who pulls to refresh while the hub still names the same capture
 * would otherwise re-render a byte-identical URL — and nothing downstream
 * revalidates it: `expo-image` is URL-keyed by design, and on native the file
 * cache would see an identity it has already settled. Bumping this epoch appends
 * `r<n>` to every live snapshot's version, so every URL changes once and every
 * surface re-asks. Session-only (not persisted) — a fresh launch starts clean.
 *
 * Thin zustand glue; the version math lives in the pure `snapshotVersionTag`
 * (`data/snapshot-media-url.ts`, unit-tested). The `snapshotCacheBucket` this
 * docblock used to name was the wall-clock bucket that version tag REPLACED —
 * it has not existed for some time.
 */
import { create } from 'zustand'

export interface SnapshotRefreshState {
  /** Monotonic manual-refresh counter folded into every snapshot cache bucket. */
  readonly epoch: number
  /** Bump the epoch — forces every mounted snapshot to fetch a fresh frame. */
  readonly bumpSnapshots: () => void
}

export const useSnapshotRefreshStore = create<SnapshotRefreshState>((set) => ({
  epoch: 0,
  bumpSnapshots: () => set((s) => ({ epoch: s.epoch + 1 })),
}))
