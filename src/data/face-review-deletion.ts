/**
 * face-review-deletion — "delete the parked faces", the rule half.
 *
 * The review grid could assign a face and detach a face, and nothing could
 * remove one. Operator, 2026-09-13: *"non esiste una funzione di cancellazione
 * samples parcheggiati"*. The crops that are nobody — a wall, a shoulder, the
 * back of a head — accumulate in the unassigned buffer and are precisely what
 * the operator scrolls past on every pass.
 *
 * `faceGallery.deleteFace` is the hub's answer, and its contract is narrow by
 * design: *"Delete an UNASSIGNED face from the buffer (row + its crop media)"*.
 * So the rule this module owns is the narrowness, stated once:
 *
 *   **A face that belongs to a PERSON is never a deletion target here.** It is
 *   not parked, the hub would refuse it, and offering it would put a gallery
 *   edit behind a button that says "tidy up". Detaching first is the
 *   reversible decision the operator already has.
 *
 * A suggestion is NOT a belonging: the cap says so itself — a suggested face
 * "stays UNASSIGNED and everything else keeps treating it as unrecognized" —
 * and a nonsense guess is one of the main reasons to want the crop gone.
 *
 * All-or-nothing, mirroring `face-review-suggestions.ts`: a mixed selection
 * names no targets at all, so a caller that ignores `ready` still writes
 * nothing. A partial delete is work dropped without saying so.
 *
 * Pure and RN-free — `__tests__/face-review-deletion.spec.ts`.
 */
import type { FaceReviewRow } from './face-cluster-review.js'

/** Everything the selection bar needs to draw the delete button: whether it may
 *  fire, what it would remove, and — when it may not — how many faces are the
 *  reason. */
export interface FaceDeletionReadiness {
  readonly selected: number
  /** Selected faces that belong to a person. `> 0` ⇒ not ready. */
  readonly blocked: number
  readonly ready: boolean
  /** EMPTY unless `ready`. */
  readonly faceIds: readonly string[]
}

/**
 * Whether the selected rows may be deleted, and which ids that would be. Pure.
 *
 * An empty selection is not ready and has `blocked: 0` — there is nothing to
 * explain, the bar's own "0 selected" already says it.
 */
export function faceDeletionReadiness(rows: readonly FaceReviewRow[]): FaceDeletionReadiness {
  let blocked = 0
  for (const row of rows) {
    if (row.status === 'assigned') blocked += 1
  }
  const ready = rows.length > 0 && blocked === 0
  return {
    selected: rows.length,
    blocked,
    ready,
    faceIds: ready ? rows.map((row) => row.faceId) : [],
  }
}
