/**
 * face-review-suggestions — "Apply suggestion" over a MULTI-SELECTION.
 *
 * The review tab's selection bar could only ever do one thing: open the detail
 * modal and write ONE identity over every selected face. That is wrong for a
 * selection of suggested faces, because `suggestedIdentityId` is a property of
 * the FACE — "THIS face's own recognizer suggestion, never a cluster's"
 * (`face-cluster-review.ts`) — so N selected faces routinely carry N different
 * suggestions. Confirming them one at a time through the detail modal was the
 * only path, and nobody walks it for 40 crops.
 *
 * Two rules, both operator decisions (design doc
 * `docs/2026-09-01-face-review-suggestions-and-groups-design.md`):
 *
 *   1. **All or nothing.** The action is offered only when EVERY selected face
 *      has a suggestion. A mixed selection would either drop the suggestion-less
 *      faces silently or force them onto someone else's name; both are work
 *      discarded without saying so. So the readiness carries `missing` — how
 *      many of the selected have no suggestion — and the bar states it, because
 *      a disabled control that will not say why is a dead end.
 *   2. **Certainty does not filter.** An `uncertain` suggestion is applied like
 *      any other if the operator selected it — that IS the use case. Certainty
 *      is shown per row (`FaceConfidenceBar`) so it can inform the selection,
 *      which is the moment it matters.
 *
 * The write is GROUPED by identity: one `assignFaces` call per distinct
 * suggested identity, never one per face. 40 faces over 3 people is 3 calls.
 *
 * Pure and RN-free — `__tests__/face-review-suggestions.spec.ts`.
 */
import type { FaceReviewRow } from './face-cluster-review.js'

/** One `assignFaces` call the apply action will make: every selected face that
 *  suggested THIS person, in selection order. */
export interface SuggestionAssignEntry {
  readonly identityId: string
  /** Display name, for the result banner — never used to resolve the target. */
  readonly name: string
  readonly faceIds: readonly string[]
}

/** Everything the selection bar needs to draw the button: whether it may fire,
 *  what it will write, and — when it may not — how many faces are the reason. */
export interface SuggestionApplyReadiness {
  readonly selected: number
  /** Selected faces with no `suggestedIdentityId`. `> 0` ⇒ not ready. */
  readonly missing: number
  readonly ready: boolean
  /** Grouped by identity. EMPTY unless `ready` — a partial write is exactly
   *  the silent work-dropping the all-or-nothing rule exists to prevent. */
  readonly plan: readonly SuggestionAssignEntry[]
}

/**
 * Group the selected rows by their OWN suggested identity, first-seen order,
 * face ids in row order. Pure.
 *
 * A row without `suggestedIdentityId` contributes nothing — the caller decides
 * whether its presence blocks the action (it does; see
 * {@link suggestionApplyReadiness}).
 */
export function groupRowsBySuggestedIdentity(
  rows: readonly FaceReviewRow[],
): SuggestionAssignEntry[] {
  const byIdentity = new Map<string, { name: string; faceIds: string[] }>()
  for (const row of rows) {
    const identityId = row.suggestedIdentityId
    if (identityId === undefined) continue
    const entry = byIdentity.get(identityId)
    if (entry === undefined) {
      byIdentity.set(identityId, {
        name: row.suggestedIdentityName ?? identityId,
        faceIds: [row.faceId],
      })
      continue
    }
    entry.faceIds.push(row.faceId)
  }
  return [...byIdentity].map(([identityId, entry]) => ({
    identityId,
    name: entry.name,
    faceIds: entry.faceIds,
  }))
}

/**
 * Whether "Apply suggestion" may fire over `rows` (the CURRENT selection), and
 * what it would write. Pure.
 *
 * Empty selection ⇒ not ready with `missing: 0`: there is nothing to explain,
 * the bar's own "0 selected" already says it.
 */
export function suggestionApplyReadiness(
  rows: readonly FaceReviewRow[],
): SuggestionApplyReadiness {
  let missing = 0
  for (const row of rows) {
    if (row.suggestedIdentityId === undefined) missing += 1
  }
  const ready = rows.length > 0 && missing === 0
  return {
    selected: rows.length,
    missing,
    ready,
    plan: ready ? groupRowsBySuggestedIdentity(rows) : [],
  }
}

/** Total faces the plan will write — the button's count. Pure. */
export function suggestionPlanFaceCount(plan: readonly SuggestionAssignEntry[]): number {
  return plan.reduce((sum, entry) => sum + entry.faceIds.length, 0)
}
