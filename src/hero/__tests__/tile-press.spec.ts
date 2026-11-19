/**
 * The double-tap arm: first tap arms, a second of the same action inside 3 s
 * fires, the window closing disarms.
 */
import { describe, expect, it } from 'vitest'
import { ARM_WINDOW_MS, DISARMED, isArmed, pressOutcome } from '../tile-press.js'

describe('pressOutcome', () => {
  it('an action with no confirm always fires', () => {
    expect(pressOutcome(DISARMED, 'lock.lock', false, 0).decision).toBe('fire')
  })
  it('the first tap of a confirmed action arms, the second inside the window fires', () => {
    const first = pressOutcome(DISARMED, 'lock.unlock', true, 1000)
    expect(first.decision).toBe('arm')
    const second = pressOutcome(first.next, 'lock.unlock', true, 1000 + ARM_WINDOW_MS - 1)
    expect(second.decision).toBe('fire')
    expect(second.next).toEqual(DISARMED)
  })
  it('a second tap after the window arms again instead of firing', () => {
    const first = pressOutcome(DISARMED, 'lock.unlock', true, 1000)
    expect(isArmed(first.next, 'lock.unlock', 1000 + ARM_WINDOW_MS)).toBe(false)
    expect(pressOutcome(first.next, 'lock.unlock', true, 1000 + ARM_WINDOW_MS).decision).toBe('arm')
  })
  it('another confirmed action never fires on the first one\'s arm', () => {
    const first = pressOutcome(DISARMED, 'lock.unlock', true, 0)
    const other = pressOutcome(first.next, 'lock.open', true, 500)
    expect(other.decision).toBe('arm')
    expect(other.next.armedId).toBe('lock.open')
  })
})
