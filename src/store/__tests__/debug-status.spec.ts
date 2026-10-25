/**
 * Local debug lifecycle: none → open → reviewed.
 *
 * No server migration. A track the hub still marks `debug: true` and that this
 * client has never seen is `open`. Reviewing clears the hub flag (so export
 * drops it) and remembers `reviewed` here so we do not re-queue it.
 */
import { describe, expect, it } from 'vitest'
import {
  parseDebugStatuses,
  resolveDebugStatus,
  reviewedIdsFrom,
  type DebugStatus,
} from '../debug-status.js'

describe('resolveDebugStatus', () => {
  it('treats a hub debug flag with no local row as open — no migration', () => {
    expect(resolveDebugStatus(true, undefined)).toBe('open')
    expect(resolveDebugStatus(true, undefined)).not.toBe('none')
  })

  it('an untouched track is none', () => {
    expect(resolveDebugStatus(undefined, undefined)).toBe('none')
    expect(resolveDebugStatus(false, undefined)).toBe('none')
  })

  it('reviewed wins over a cleared hub flag — that is the point of reviewing', () => {
    expect(resolveDebugStatus(false, 'reviewed')).toBe('reviewed')
    expect(resolveDebugStatus(undefined, 'reviewed')).toBe('reviewed')
  })

  it('an explicit re-mark on the hub re-opens a reviewed track', () => {
    expect(resolveDebugStatus(true, 'reviewed')).toBe('open')
  })

  it('a stored open with the hub flag gone is none (operator unmarked)', () => {
    expect(resolveDebugStatus(false, 'open')).toBe('none')
  })
})

describe('parseDebugStatuses', () => {
  it('keeps only open and reviewed ids', () => {
    const parsed = parseDebugStatuses({
      a: 'open',
      b: 'reviewed',
      c: 'none',
      d: 'nope',
      e: 1,
    })
    expect(parsed).toEqual({ a: 'open', b: 'reviewed' })
  })

  it('degrades a corrupt blob to empty', () => {
    expect(parseDebugStatuses(null)).toEqual({})
    expect(parseDebugStatuses(['open'])).toEqual({})
  })
})

describe('debug filter chip — only open', () => {
  function matchesDebugChip(
    debug: boolean | undefined,
    stored: DebugStatus | undefined,
  ): boolean {
    return resolveDebugStatus(debug, stored) === 'open'
  }

  it('hides reviewed tracks from the debug chip', () => {
    expect(matchesDebugChip(false, 'reviewed')).toBe(false)
    expect(matchesDebugChip(true, undefined)).toBe(true)
  })
})

describe('reviewedIdsFrom', () => {
  it('lists only reviewed ids, in a new array', () => {
    expect(reviewedIdsFrom({ a: 'open', b: 'reviewed', c: 'reviewed' })).toEqual(['b', 'c'])
  })
})
