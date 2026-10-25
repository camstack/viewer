/**
 * use-track-flags — the two per-track OPERATOR flags, written from the viewer.
 *
 * `markForTrain` marks a track as training material and PINS it against
 * retention: the track and every frame it owns stop ageing out until the mark is
 * removed ([D81](../../../docs/decisions/adr-0081.md)). `debug` marks a track for
 * diagnostic attention and pins nothing.
 *
 * The same pair is written from the admin UI's Events grid and from the theater
 * cluster detail. Three surfaces, none of which knows what the others last did,
 * which forces four rules:
 *
 *  1. **One key per patch.** `pipelineAnalytics.setTrackFlags` takes a PARTIAL
 *     patch and leaves an omitted key untouched. Sending both keys would make
 *     every toggle overwrite the other surface's last write.
 *  2. **The server's answer is the state.** A click is a request, not a fact.
 *     The hook returns what came back, so a REFUSED write — the hub enforces a
 *     per-camera pin budget and rejects a new mark past it — leaves the switch
 *     where it was instead of showing a lie.
 *  3. **Absent renders OFF.** A never-touched track omits the field, so a
 *     consumer tests `=== true`, never `!== false`.
 *  4. **A write publishes itself to the read.** The toggles render from a
 *     cached `TrackSummary`; a write that does not update that row is invisible
 *     the moment the surface remounts. See `onSuccess` below — this is the
 *     defect behind "I set a flag, I come back, it is off".
 *
 * Deliberately NOT optimistic, and deliberately not seeded from the feed row in
 * an effect. `useSetCameraSwitch` is optimistic because a switch is a physical
 * expectation the operator wants met instantly; this is a curation mark whose
 * write can be legitimately refused, and rolling one back after the fact is
 * exactly the flicker rule 2 exists to avoid.
 */
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import { capMutateOrThrow, isRecord } from './cap-query.js'
import { trackByIdQueryKey } from './use-track-by-id.js'
import type { TrackSummary } from './track-events.js'
import { useTrackFlagOverlayStore } from '../store/track-flag-overlay-store.js'

/** The resolved state of BOTH flags, as the hub reports it after a write. */
export interface TrackFlagsResult {
  readonly trackId: string
  readonly markForTrain: boolean
  readonly debug: boolean
  /** The operator's note as it STANDS after the write — `''` when there is
   *  none. Never absent: a surface that has just written must be able to seed
   *  its editor from the answer without a re-fetch. */
  readonly debugNote: string
  readonly favourited: boolean
}

/** A PARTIAL patch — exactly one key per call. */
export interface TrackFlagsPatch {
  readonly markForTrain?: boolean
  readonly debug?: boolean
  /**
   * The note, when the operator has just written one. Its own key, sent on its
   * own: the flag write must not wait for the operator to finish typing, and an
   * edit must not carry a flag it would otherwise re-assert. The hub owns the
   * coupling (a `debug: false` write clears the note), which is why this side
   * never has to send both.
   */
  readonly debugNote?: string
  readonly favourited?: boolean
}

/**
 * WHICH flag an in-flight patch writes — rule 1 above guarantees exactly one
 * key per call, so this names the ONE button whose icon should become a
 * spinner while the round trip runs. The operator's report behind it: "no
 * loader appears when I activate a flag" — dimming all three to 0.5 read as
 * nothing happening. Null for the (never-sent) empty patch. Pure.
 */
export function pendingFlagKey(patch: TrackFlagsPatch): keyof TrackFlagsPatch | null {
  if (patch.markForTrain !== undefined) return 'markForTrain'
  if (patch.debug !== undefined) return 'debug'
  if (patch.debugNote !== undefined) return 'debugNote'
  if (patch.favourited !== undefined) return 'favourited'
  return null
}

export interface SetTrackFlagsInput {
  readonly deviceId: number
  readonly trackId: string
  readonly flags: TrackFlagsPatch
}

/**
 * Validate the mutation's answer. `null` for anything that is not the full
 * resolved triple — a partially-shaped response must not be allowed to drive a
 * toggle, because the fields it is missing would read as `false` and silently
 * un-mark the other flag on screen.
 */
export function toTrackFlagsResult(raw: unknown): TrackFlagsResult | null {
  if (!isRecord(raw)) return null
  const { trackId, markForTrain, debug, debugNote, favourited } = raw
  if (typeof trackId !== 'string' || trackId.length === 0) return null
  if (
    typeof markForTrain !== 'boolean' ||
    typeof debug !== 'boolean' ||
    typeof favourited !== 'boolean'
  ) {
    return null
  }
  // The note is the ONE field an older hub legitimately omits — it is additive,
  // and a hub without the column answers the three booleans exactly as before.
  // Rejecting the answer over it would break the toggles against every hub that
  // has not been updated yet, which is the opposite of what the strictness
  // above is for.
  return { trackId, markForTrain, debug, debugNote: typeof debugNote === 'string' ? debugNote : '', favourited }
}

/**
 * Rule 4's publication, extracted so a FUSED id can run it twice (D683).
 *
 * `askedId` is the id the caller wrote with; `next.trackId` is the hub's
 * answer. The hub resolves an absorbed id to its survivor before the write
 * ever reaches the row (D683 §6.6 cap-boundary resolution), so a track that
 * was fused between the viewer's last read and this write gets back a
 * `trackId` that differs from `askedId`. A delivery in flight when that
 * happened — the recognition wait, an outbox retry, AI narration — may still
 * be holding `askedId`'s cached row, and it must not keep reading the
 * pre-write flags forever. Publishing under BOTH ids costs one extra
 * `setQueryData`/`invalidateQueries` pair and guarantees neither row is
 * stale; publishing only under `next.trackId` is exactly the bug this
 * guards — see the spec header in `track-alias-read.spec.ts`.
 */
export function publishTrackAnswer(
  qc: QueryClient,
  deviceId: number,
  askedId: string,
  next: TrackFlagsResult,
): void {
  const ids = next.trackId === askedId ? [askedId] : [askedId, next.trackId]
  for (const id of ids) {
    const key = trackByIdQueryKey(deviceId, id)
    qc.setQueryData<TrackSummary | null>(key, (prev) =>
      prev === undefined || prev === null
        ? prev
        : {
            ...prev,
            markForTrain: next.markForTrain,
            debug: next.debug,
            debugNote: next.debugNote,
            favourited: next.favourited,
          },
    )
    void qc.invalidateQueries({ queryKey: key })
    // Same reasoning as the cache write above: the live feed card may still
    // be showing the asked (now-absorbed) id when the write resolves, so the
    // overlay has to reach it there too, not only under the survivor.
    useTrackFlagOverlayStore.getState().apply(id, {
      debug: next.debug,
      markForTrain: next.markForTrain,
      favourited: next.favourited,
    })
  }
}

export function useSetTrackFlags(): UseMutationResult<
  TrackFlagsResult,
  Error,
  SetTrackFlagsInput
> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ deviceId, trackId, flags }: SetTrackFlagsInput) => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw = await capMutateOrThrow(
        system.trpcClient as unknown as Record<string, unknown>,
        'pipelineAnalytics',
        'setTrackFlags',
        { deviceId, trackId, flags },
      )
      const next = toTrackFlagsResult(raw)
      if (next === null) throw new Error('track flags unreadable')
      return next
    },
    // Rule 4: a write PUBLISHES itself to the read that renders it.
    //
    // The toggles are driven from a `TrackSummary`, and on every embed surface
    // that summary is `useTrackById`'s cached row. Nothing here used to touch
    // it, so the row kept the pre-write flags for its full 60 s `staleTime` —
    // long enough that closing the detail and reopening it (the operator's
    // actual loop, measured in seconds) reliably showed every flag back OFF.
    // The mark WAS on the hub the whole time; only the copy the UI read was
    // stale.
    //
    // Both halves are needed and neither is optimistic — this runs after the
    // hub has answered, and it writes the hub's ANSWER (`next`), never the
    // requested patch, so a refusal still publishes nothing:
    //   • `setQueryData` makes the very next re-open correct with no round trip;
    //   • `invalidateQueries` marks the row stale so a later mount re-reads it
    //     from the hub rather than trusting this merge forever.
    onSuccess: (next, { deviceId, trackId }) => {
      publishTrackAnswer(queryClient, deviceId, trackId, next)
    },
  })
}
