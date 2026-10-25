/**
 * face-certainty-style — the ONE mapping from a {@link FaceSuggestionCertainty}
 * to its tint and its translated word.
 *
 * Two surfaces render the same certainty (the badge word and the confidence
 * bar's fill), and a repo that has already shipped one confidence bar meaning
 * two different things must not let those two drift to different colours.
 */
import type { ColorTokens } from '../../theme/tokens.js'
import type { FaceSuggestionCertainty } from '../../data/face-cluster-review.js'

export const FACE_CERTAINTY_LABEL_KEY: Readonly<Record<FaceSuggestionCertainty, string>> = {
  certain: 'v2.faceReview.certaintyCertain',
  probable: 'v2.faceReview.certaintyProbable',
  uncertain: 'v2.faceReview.certaintyUncertain',
}

export function faceCertaintyTint(certainty: FaceSuggestionCertainty, colors: ColorTokens): string {
  if (certainty === 'certain') return colors.success
  if (certainty === 'probable') return colors.warning
  return colors.danger
}
