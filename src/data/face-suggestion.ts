/**
 * face-suggestion — pure helpers for the "suggested identity" affordance shown
 * on a face the recognizer found a PLAUSIBLE-but-not-confident match for. The
 * server populates the two additive `FaceInfo` fields — `suggestedIdentityId`
 * and `suggestedMatchScore` (0..1) — when a match was plausible (acceptance band
 * ~0.50–0.62, or a good score on a small face) but NOT confident enough to
 * auto-assign, so `recognizedIdentityId` stays unset. This module turns that
 * telemetry into a "the recognizer THINKS this is <Name> — confirm or dismiss?"
 * prompt.
 *
 * Framework-free on purpose: the visibility predicate + name resolution are the
 * only logic worth testing, and keeping them out of the RN/theme/store layer
 * lets the node vitest env cover them (`data/__tests__/face-suggestion.spec.ts`).
 */

/** Minimal identity shape for name resolution (both `PersonIdentity` and the
 *  theater `IdentityInfo` are structurally assignable to it). */
export interface SuggestionIdentity {
  readonly id: string
  readonly name: string
}

/** Inputs for {@link shouldShowSuggestion}. */
export interface SuggestionVisibilityArgs {
  /** The face already links to a person (auto-recognized OR manual) → a
   *  suggestion would be redundant, so it's suppressed. */
  readonly hasPerson: boolean
  /** The server's suggested identity id; `undefined`/empty ⇒ no suggestion. */
  readonly suggestedIdentityId: string | undefined
  /** faceIds the operator has locally dismissed (device-local, persisted). */
  readonly dismissedFaceIds: ReadonlySet<string>
  /** This face's id — tested against the dismissed set. */
  readonly faceId: string
}

/**
 * Show the suggestion row when ALL hold: the face has NO linked person, the
 * server offered a suggested identity, and the operator hasn't locally dismissed
 * THIS face. Pure — the caller drops the row in unconditionally and lets this
 * (via the component) self-hide, mirroring `FaceConfidenceBadge`.
 */
export function shouldShowSuggestion(args: SuggestionVisibilityArgs): boolean {
  const { hasPerson, suggestedIdentityId, dismissedFaceIds, faceId } = args
  if (hasPerson) return false
  if (typeof suggestedIdentityId !== 'string' || suggestedIdentityId.length === 0) return false
  if (dismissedFaceIds.has(faceId)) return false
  return true
}

/**
 * Resolve the suggested identity's display name from the loaded identities list,
 * falling back to a neutral label when the identity no longer exists (it can be
 * deleted after the suggestion was stored). Pure.
 */
export function resolveSuggestedName(
  identities: readonly SuggestionIdentity[],
  suggestedIdentityId: string,
  fallbackLabel: string,
): string {
  for (const identity of identities) {
    if (identity.id === suggestedIdentityId && identity.name.length > 0) return identity.name
  }
  return fallbackLabel
}
