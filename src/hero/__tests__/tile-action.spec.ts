/**
 * The lock's "Open door" action and the armed caption.
 */
import { describe, expect, it } from 'vitest'
import { LOCK_OPEN_ACTION, armCaptionKey, lockOpenAvailable } from '../tile-action.js'

describe('lock.open', () => {
  it('is offered only to a lock with the feature that is at rest', () => {
    expect(lockOpenAvailable(['lock-open', 'lock'], 'locked')).toBe(true)
    expect(lockOpenAvailable(['lock-open'], 'unlocked')).toBe(true)
    expect(lockOpenAvailable(['lock'], 'locked')).toBe(false)
    expect(lockOpenAvailable(['lock-open'], 'jammed')).toBe(false)
    expect(lockOpenAvailable(['lock-open'], null)).toBe(false)
  })
  it('is double-tap confirmed and says so in its caption', () => {
    expect(LOCK_OPEN_ACTION.confirm).toBe('unlock')
    expect(armCaptionKey('lock.open')).toBe('v2.hero.tapAgain.open')
    expect(armCaptionKey('lock.unlock')).toBe('v2.hero.tapAgain.unlock')
  })
})
