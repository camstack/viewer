/**
 * FaceReviewSelectionBar — the bar that appears under the filters while the
 * review grid is in multi-select mode.
 *
 * It carries THREE writes, and they are not variants of each other:
 *
 *   • **Assign** opens the detail modal and puts ONE person on every selected
 *     face. Right when the operator is naming a batch of the same face.
 *   • **Apply suggestions** puts each selected face on ITS OWN suggested
 *     person — N faces can land on N people from one tap. Right when the
 *     operator has just skimmed a screen of `suggested` crops and agrees with
 *     the recognizer. Until 2026-09-01 the only way to do this was the detail
 *     modal, one face at a time.
 *
 *   • **Delete** removes the selected faces from the review buffer for good —
 *     the crops that are nobody (a wall, a shoulder, the back of a head) and
 *     which until 2026-09-13 had no way out of the grid at all. It is offered
 *     ONLY over faces that belong to no person; `face-review-deletion.ts` owns
 *     that rule and says why.
 *
 * Both conditional actions follow the same discipline: offered only when the
 * whole selection qualifies, and when it does not, the button is disabled AND
 * the bar says how many faces are the reason — a disabled control that will
 * not explain itself sends the operator hunting through the grid for a face it
 * already knows about. Each states its OWN reason: two disabled buttons over
 * one silent line is a line that belongs to neither.
 */
import React, { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ReviewSelectionBar } from '../review/ReviewSelectionBar.js'
import type { FaceDeletionReadiness } from '../../data/face-review-deletion.js'
import type { SuggestionApplyReadiness } from '../../data/face-review-suggestions.js'

export interface FaceReviewSelectionBarProps {
  readonly selectedCount: number
  /** Derived from the CURRENT selection by `suggestionApplyReadiness`. */
  readonly suggestions: SuggestionApplyReadiness
  /** Derived from the CURRENT selection by `faceDeletionReadiness`. */
  readonly deletion: FaceDeletionReadiness
  readonly onCancel: () => void
  /** Opens the detail modal over the whole selection — one person for all. */
  readonly onAssign: () => void
  /** Writes each face to its own suggested person, grouped by identity. */
  readonly onApplySuggestions: () => void
  /** Removes the selected faces from the review buffer. Confirmed by the caller. */
  readonly onDelete: () => void
}

export const FaceReviewSelectionBar = memo(function FaceReviewSelectionBar({
  selectedCount,
  suggestions,
  deletion,
  onCancel,
  onAssign,
  onApplySuggestions,
  onDelete,
}: FaceReviewSelectionBarProps) {
  const { t } = useTranslation()

  // What Apply WOULD write. Equal to the selection when ready; when it is not,
  // it is still the honest half of the picture the reason line completes.
  const applicable = suggestions.selected - suggestions.missing
  const blocked = selectedCount > 0 && suggestions.missing > 0
  const deleteBlocked = selectedCount > 0 && deletion.blocked > 0

  return (
    <ReviewSelectionBar
      selectedCount={selectedCount}
      countLabel={t('v2.faceReview.selectionCount', { count: selectedCount })}
      cancelLabel={t('v2.settings.cancel')}
      assignLabel={t('v2.faceReview.assign')}
      deleteLabel={t('v2.faceReview.deleteSelected')}
      applyLabel={t('v2.faceReview.applySuggestions', { count: applicable })}
      applyReady={suggestions.ready}
      applyReason={blocked ? t('v2.faceReview.applySuggestionsBlocked', { count: suggestions.missing }) : null}
      deleteReady={deletion.ready}
      deleteReason={deleteBlocked ? t('v2.faceReview.deleteBlocked', { count: deletion.blocked }) : null}
      onCancel={onCancel}
      onAssign={onAssign}
      onApplySuggestions={onApplySuggestions}
      onDelete={onDelete}
    />
  )
})
