/**
 * face-confidence — pure helpers that turn the face-gallery match telemetry
 * (`bestMatchScore`, a winning cosine similarity 0..1, plus the optional
 * `nativeFaceShortSidePx`) into the compact confidence badge shown on an
 * AUTO-assigned face so the operator can SEE why the recognizer picked a person.
 *
 * Framework-free on purpose: the tint band + label format are the only logic
 * worth testing, and keeping them out of the RN/theme layer lets the node
 * vitest env cover them (`data/__tests__/face-confidence.spec.ts`).
 */

/** Quality band for an auto-match score; the badge maps this to a theme colour. */
export type FaceConfidenceTone = 'good' | 'medium' | 'low'

/** Auto-assign acceptance floor — a match below this shouldn't occur post-threshold. */
export const FACE_CONFIDENCE_MEDIUM_THRESHOLD = 0.62
/** At/above this the match is a confident, high-quality recognition. */
export const FACE_CONFIDENCE_GOOD_THRESHOLD = 0.75

/**
 * Band a winning cosine similarity: `>=0.75` good, `0.62..0.75` medium, `<0.62`
 * low (shouldn't occur once the recognizer's threshold gate is applied, but is
 * styled as a warning if it slips through). Pure.
 */
export function faceConfidenceTone(score: number): FaceConfidenceTone {
  if (score >= FACE_CONFIDENCE_GOOD_THRESHOLD) return 'good'
  if (score >= FACE_CONFIDENCE_MEDIUM_THRESHOLD) return 'medium'
  return 'low'
}

/**
 * Compact badge label for an auto-match: the score as a whole percentage, with
 * the native face size appended when known (e.g. `"62%"` or `"62% · 54px"`).
 * Returns null when there is no usable score (legacy rows / manual assignments
 * carry `undefined`) so the caller renders no badge. Pure.
 */
export function formatFaceConfidence(
  score: number | undefined,
  px: number | undefined,
): string | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  const pct = `${Math.round(score * 100)}%`
  if (typeof px === 'number' && Number.isFinite(px) && px > 0) {
    return `${pct} · ${Math.round(px)}px`
  }
  return pct
}
