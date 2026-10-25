/**
 * events-count — the count line under the Events header row ("24 events"),
 * the same line every Library page shows. Pure, so it is unit testable.
 *
 * Unanswered is not empty: while the first page is in flight, or when the feed
 * failed, the line stays blank (its height kept) rather than saying "0 events".
 * A feed with more pages to fetch says "24+ events" — the grid holds what has
 * loaded, not the day's total.
 */
import type { FeedTailReason } from '../../../shared/events/events-feed.js'

export interface EventsCountInput {
  readonly rows: number
  readonly loading: boolean
  readonly error: string | null
  readonly tail: FeedTailReason
}

/** A `t` narrowed to what this line needs, so the function is framework-free. */
export type EventsCountT = (key: 'v2.events.count' | 'v2.events.countMore', options: { count: number }) => string

/** A blank that keeps the line's height. */
export const EVENTS_COUNT_BLANK = ' '

export function eventsCountSummary({ rows, loading, error, tail }: EventsCountInput, t: EventsCountT): string {
  if (error !== null) return EVENTS_COUNT_BLANK
  if (loading && rows === 0) return EVENTS_COUNT_BLANK
  return t(tail === 'more' ? 'v2.events.countMore' : 'v2.events.count', { count: rows })
}
