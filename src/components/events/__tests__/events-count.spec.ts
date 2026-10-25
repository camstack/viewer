/**
 * The Events count line: blank while unanswered or failed, "N+" while more
 * pages exist, the plain count once the feed is exhausted or at its ceiling.
 */
import { describe, expect, it } from 'vitest'
import { EVENTS_COUNT_BLANK, eventsCountSummary, type EventsCountT } from '../events-count.js'

const t: EventsCountT = (key, { count }) => `${key}:${String(count)}`

describe('eventsCountSummary', () => {
  it('is blank, not "0 events", while the first page is in flight', () => {
    expect(eventsCountSummary({ rows: 0, loading: true, error: null, tail: 'more' }, t)).toBe(EVENTS_COUNT_BLANK)
  })
  it('is blank when the feed failed', () => {
    expect(eventsCountSummary({ rows: 4, loading: false, error: 'boom', tail: 'exhausted' }, t)).toBe(EVENTS_COUNT_BLANK)
  })
  it('says N+ while more pages exist', () => {
    expect(eventsCountSummary({ rows: 50, loading: false, error: null, tail: 'more' }, t)).toBe('v2.events.countMore:50')
  })
  it('keeps the count of what has loaded during a refresh', () => {
    expect(eventsCountSummary({ rows: 12, loading: true, error: null, tail: 'exhausted' }, t)).toBe('v2.events.count:12')
  })
  it('says the plain count, zero included, once the feed answered', () => {
    expect(eventsCountSummary({ rows: 0, loading: false, error: null, tail: 'exhausted' }, t)).toBe('v2.events.count:0')
    expect(eventsCountSummary({ rows: 200, loading: false, error: null, tail: 'ceiling' }, t)).toBe('v2.events.count:200')
  })
})
