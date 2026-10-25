/**
 * track-media-entry — the three states ONE media entry can be in, and the
 * `kinds` argument that fetches exactly that one entry.
 *
 * ## Why this module exists at all
 *
 * The detail lists what a track HAS from `listTrackMedia` (a manifest: keys,
 * kinds, sizes — measured 7 rows in 0.25 s, no bytes) and then loads the bytes
 * of the SELECTED entry only, through `getTrackMedia` restricted to that one
 * kind. Asking for the whole block is what made the modal unusable: on a hub
 * under disk contention `getTrackMedia` with no `kinds` filter runs into the
 * 60 s ceiling, so the operator saw NOTHING — and read it as "this track has
 * no media", which is the one conclusion the data ruled out. The rows were
 * indexed; only the pixels were slow.
 *
 * So the states must be three, and they must be told apart:
 *
 *   • `loading` — the index says this entry exists, its bytes are on the way;
 *   • `error`   — the index says this entry exists and the read FAILED. Says
 *                 so, and offers a retry. NEVER paints as absence;
 *   • `absent`  — the index does not list this entry. A real answer.
 *
 * `ready` is the fourth, uninteresting one — and it is also where a tile the
 * manifest never listed belongs: `ready` with no bytes, rendered from its
 * data-plane URL. See {@link trackMediaEntryNeedsFetch}.
 *
 * ## The rule the whole file is here to enforce
 *
 * {@link resolveTrackMediaEntryState} maps "the call answered, but carried no
 * bytes for a key the MANIFEST listed" to `error`, not to `absent`. An entry
 * the index vouched for cannot become non-existent because a byte read came
 * back thin — that is a failed read wearing absence's clothes, and it is the
 * exact confusion that sent an audit down the wrong path.
 *
 * Pure: no React, no `any`, no network. Unit-tested under the node environment.
 */

import { mediaFileId, type MediaFileLite } from './track-events.js'

// ─── The kinds the cap can be asked for ───────────────────────────────────────

/**
 * The `kind` values `pipelineAnalytics.getTrackMedia` accepts (its Zod enum).
 *
 * Held here so a selection whose kind the cap does not know is never SENT: the
 * server would reject it, `rethrow` would surface the rejection, and the view
 * would report "could not read this media" about a file that is merely of an
 * unfamiliar kind. A wrong error is worse than none — see
 * {@link trackMediaEntryNeedsFetch}, which routes those to the data plane URL.
 */
export const TRACK_MEDIA_BYTE_KINDS = [
  'crop',
  'thumbnail',
  'snapshot',
  'firstFrame',
  'lastFrame',
  'fullFrame',
  'fullFrameBoxed',
  'faceCrop',
  'plateCrop',
  'keyFrame',
  'keyFrameSmall',
  'thumbnailSmall',
] as const

/** One of {@link TRACK_MEDIA_BYTE_KINDS}. */
export type TrackMediaByteKind = (typeof TRACK_MEDIA_BYTE_KINDS)[number]

/** Whether `getTrackMedia` can be asked for this kind. */
export function isTrackMediaByteKind(kind: string): kind is TrackMediaByteKind {
  return (TRACK_MEDIA_BYTE_KINDS as readonly string[]).includes(kind)
}

/**
 * The `kinds` argument for ONE entry.
 *
 * The return type is a one-tuple on purpose: a caller cannot widen this into
 * "well, while we're here, fetch the others too" without changing the
 * signature, and the whole point of the lazy load is that the block is never
 * requested.
 */
export function restrictKindsToEntry(kind: TrackMediaByteKind): readonly [TrackMediaByteKind] {
  return [kind]
}

// ─── The three (plus one) states ──────────────────────────────────────────────

/**
 * What the viewer can say about one media entry.
 *
 * `ready.base64` is `null` for an entry whose bytes the cap cannot serve (an
 * unfamiliar kind): the entry is real and renderable, just from its data-plane
 * URL rather than from bytes in hand. It is deliberately NOT a separate status
 * — the operator-facing distinction is loading / failed / not-there, and a
 * fifth status would only invite a view to forget one.
 */
export type TrackMediaEntryState =
  | { readonly status: 'absent' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly base64: string | null }

/** Everything {@link resolveTrackMediaEntryState} needs, and nothing React. */
export interface TrackMediaEntryInputs {
  /** The entry the operator selected, or `null` when the index lists none. */
  readonly selected: MediaFileLite | null
  /** The byte read threw (server error, deadline, dead node). */
  readonly fetchFailed: boolean
  /** The byte read's rows, or `null` while it has not answered. */
  readonly rows: readonly MediaFileLite[] | null
}

/**
 * True when this selection still needs a byte fetch — i.e. it exists, its bytes
 * are not already in hand, the MANIFEST listed it, and the cap knows its kind.
 *
 * Two branches keep a call from being made that cannot be answered:
 *
 *   • bytes already in hand — a legacy plate-gallery tile can arrive inline;
 *     paying a round-trip for what is in memory is the block fetch in
 *     miniature;
 *   • `offManifest` — the tile came from ANOTHER capability. The docblock here
 *     used to assert that the plate-gallery tile "arrives WITH its bytes", and
 *     that is false on every hub that serves `cropUrl`: `parsePlateInfo` keeps
 *     `base64` undefined and the tile carries a media KEY. The assertion read
 *     as verification and nothing checked it, so v1.0.405 asked
 *     `getTrackMedia({ kinds: ['plateCrop'] })` for a row stored under
 *     `('plate', 'plate-<trackId>')` with `kind: 'crop'` — wrong owner, wrong
 *     kind, answer `[]`, reported to the operator as a broken read.
 */
export function trackMediaEntryNeedsFetch(selected: MediaFileLite | null): boolean {
  if (selected === null) return false
  if (selected.base64 !== undefined && selected.base64.length > 0) return false
  if (selected.offManifest === true) return false
  return isTrackMediaByteKind(selected.kind)
}

/**
 * Resolve one entry's state.
 *
 * Order is load-bearing:
 *   1. nothing selected            → `absent`   (the index lists no such entry)
 *   2. bytes already in hand       → `ready`
 *   3. not listed by the manifest  → `ready(null)` — render from the URL
 *   4. kind the cap cannot serve   → `ready(null)` — render from the URL
 *   5. the read threw              → `error`
 *   6. no answer yet               → `loading`
 *   7. answered WITH the bytes     → `ready`
 *   8. answered WITHOUT the bytes  → `error`  ← never `absent`
 *
 * Step 8 is the rule this module exists for, and step 3 is its precondition:
 * the manifest must actually have vouched for the key. When it did, a byte
 * answer that omits it is a read that failed quietly, and reporting that as
 * "no such media" is how an operator concludes a camera stored nothing when in
 * fact the disk was busy. When it did NOT — a tile another capability supplied
 * — the empty answer means only that the cap was asked the wrong question, and
 * calling that a failure paints a triangle over an image that renders fine.
 */
export function resolveTrackMediaEntryState(
  inputs: TrackMediaEntryInputs,
): TrackMediaEntryState {
  const { selected, fetchFailed, rows } = inputs
  if (selected === null) return { status: 'absent' }

  if (selected.base64 !== undefined && selected.base64.length > 0) {
    return { status: 'ready', base64: selected.base64 }
  }
  if (selected.offManifest === true) return { status: 'ready', base64: null }
  if (!isTrackMediaByteKind(selected.kind)) return { status: 'ready', base64: null }

  if (fetchFailed) return { status: 'error' }
  if (rows === null) return { status: 'loading' }

  const selectedId = mediaFileId(selected)
  const hit = rows.find(
    (row) => mediaFileId(row) === selectedId && row.base64 !== undefined && row.base64.length > 0,
  )
  if (hit?.base64 !== undefined) return { status: 'ready', base64: hit.base64 }
  return { status: 'error' }
}
