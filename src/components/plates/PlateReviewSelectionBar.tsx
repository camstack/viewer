/** PlateReviewSelectionBar — `ReviewSelectionBar` with the Plates page's strings. */
import React, { memo } from 'react'
import { useTranslation } from 'react-i18next'

import type { PlateDeletionReadiness, PlateSuggestionReadiness } from '../../data/plate-review.js'
import { ReviewSelectionBar } from '../review/ReviewSelectionBar.js'

export interface PlateReviewSelectionBarProps {
  readonly selectedCount: number
  /** Derived from the CURRENT selection by `plateSuggestionReadiness`. */
  readonly suggestions: PlateSuggestionReadiness
  /** Derived from the CURRENT selection by `plateDeletionReadiness`. */
  readonly deletion: PlateDeletionReadiness
  readonly onCancel: () => void
  readonly onAssign: () => void
  readonly onApplySuggestions: () => void
  readonly onDelete: () => void
}

export const PlateReviewSelectionBar = memo(function PlateReviewSelectionBar({
  selectedCount,
  suggestions,
  deletion,
  onCancel,
  onAssign,
  onApplySuggestions,
  onDelete,
}: PlateReviewSelectionBarProps) {
  const { t } = useTranslation()
  const applicable = suggestions.selected - suggestions.missing
  return (
    <ReviewSelectionBar
      selectedCount={selectedCount}
      countLabel={t('v2.plateReview.selectionCount', { count: selectedCount })}
      cancelLabel={t('v2.settings.cancel')}
      assignLabel={t('v2.plateReview.assign')}
      deleteLabel={t('v2.plateReview.deleteSelected')}
      applyLabel={t('v2.plateReview.applySuggestions', { count: applicable })}
      applyReady={suggestions.ready}
      applyReason={
        selectedCount > 0 && suggestions.missing > 0
          ? t('v2.plateReview.applySuggestionsBlocked', { count: suggestions.missing })
          : null
      }
      deleteReady={deletion.ready}
      deleteReason={
        selectedCount > 0 && deletion.blocked > 0 ? t('v2.plateReview.deleteBlocked', { count: deletion.blocked }) : null
      }
      onCancel={onCancel}
      onAssign={onAssign}
      onApplySuggestions={onApplySuggestions}
      onDelete={onDelete}
    />
  )
})
