import { describe, expect, it } from 'vitest'
import {
  networkTimingFor,
  pickEntry,
  summariseEntry,
  type ResourceEntryLike,
} from '../resource-timing'

const entry = (o: Partial<ResourceEntryLike>): ResourceEntryLike => ({
  startTime: 0,
  requestStart: 0,
  responseStart: 0,
  responseEnd: 0,
  ...o,
})

describe('summariseEntry', () => {
  it('splits the browser-measured request into queue and time-to-first-byte', () => {
    const t = summariseEntry(
      entry({ startTime: 100, requestStart: 340, responseStart: 380, responseEnd: 400, transferSize: 6102 }),
    )
    expect(t).toEqual({ totalMs: 300, queuedMs: 240, ttfbMs: 40, transferSize: 6102 })
  })

  it('returns null for an entry that has not completed', () => {
    expect(summariseEntry(entry({ startTime: 10, requestStart: 12, responseEnd: 0 }))).toBeNull()
  })

  it('refuses to report an OPAQUE cross-origin entry as zero network time', () => {
    // Without Timing-Allow-Origin the browser zeroes the phases. Reporting
    // "0 ms on the wire" would look like proof that the thread was to blame.
    expect(
      summariseEntry(entry({ startTime: 5, requestStart: 0, responseStart: 0, responseEnd: 900 })),
    ).toBeNull()
  })
})

describe('pickEntry', () => {
  it('ignores entries from an earlier fetch of the same URL', () => {
    const old = entry({ startTime: 10, requestStart: 11, responseStart: 12, responseEnd: 20 })
    const mine = entry({ startTime: 500, requestStart: 505, responseStart: 520, responseEnd: 540 })
    expect(pickEntry([old, mine], 500)).toBe(mine)
  })

  it('takes the EARLIEST qualifying entry, not the last — a later one may still be in flight', () => {
    const a = entry({ startTime: 500, responseEnd: 540, requestStart: 501, responseStart: 530 })
    const b = entry({ startTime: 800, responseEnd: 830, requestStart: 801, responseStart: 820 })
    expect(pickEntry([b, a], 490)).toBe(a)
  })

  it('allows 1 ms of slack at the boundary', () => {
    const e = entry({ startTime: 499.4, requestStart: 500, responseStart: 510, responseEnd: 520 })
    expect(pickEntry([e], 500)).toBe(e)
  })

  it('is null when nothing qualifies', () => {
    expect(pickEntry([entry({ startTime: 1, responseEnd: 2 })], 900)).toBeNull()
  })
})

describe('networkTimingFor', () => {
  it('reads the browser entry for this attempt', () => {
    const t = networkTimingFor('https://h/m/1', 100, {
      getEntriesByName: () => [
        entry({ startTime: 100, requestStart: 110, responseStart: 150, responseEnd: 160, transferSize: 512 }),
      ],
    })
    expect(t).toEqual({ totalMs: 60, queuedMs: 10, ttfbMs: 40, transferSize: 512 })
  })

  it('is null — never a fabricated zero — when Resource Timing is unavailable', () => {
    expect(networkTimingFor('https://h/m/1', 0, null)).toBeNull()
  })

  it('never throws when the source misbehaves', () => {
    expect(
      networkTimingFor('https://h/m/1', 0, {
        getEntriesByName: () => {
          throw new Error('not supported')
        },
      }),
    ).toBeNull()
  })
})
