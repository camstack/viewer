/**
 * One review page's tile display (time, camera) — read from and written to the
 * settings document (`settings.review`, ACCOUNT level, like the events tiles'
 * details). The object is stable while the choice is, so a memoised tile does
 * not redraw on an unrelated settings write.
 */
import { useCallback, useMemo } from 'react'
import { useSettings } from '../../data/use-settings.js'
import { reviewDisplayWrites, reviewTileDisplayFor, type ReviewPage, type ReviewTileDisplay } from './review-tile.js'

export interface ReviewTileDisplayState {
  readonly display: ReviewTileDisplay
  readonly onDisplayChange: (next: ReviewTileDisplay) => void
}

export function useReviewTileDisplay(page: ReviewPage): ReviewTileDisplayState {
  const { settings, setReview } = useSettings()
  const { showDate, showCamera } = reviewTileDisplayFor(page, settings.review)
  const display = useMemo<ReviewTileDisplay>(() => ({ showDate, showCamera }), [showDate, showCamera])
  const onDisplayChange = useCallback(
    (next: ReviewTileDisplay) => {
      for (const write of reviewDisplayWrites(page, display, next)) setReview(write.key, write.value)
    },
    [page, display, setReview],
  )
  return { display, onDisplayChange }
}
