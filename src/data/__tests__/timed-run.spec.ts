import { describe, expect, it } from 'vitest'
import {
  formatRemaining, hasTimedRun, quickRunToShow, refusalMessageKey, remainingSeconds,
  toTimedRunOutcome, toTimedRunStatus,
} from '../timed-run.js'

describe('visibility: the status answered with a quick run', () => {
  it('the binding is the feature name, never the device type', () => {
    expect(hasTimedRun(['switch', 'timed-run'])).toBe(true)
    expect(hasTimedRun(['switch'])).toBe(false)
    expect(hasTimedRun([])).toBe(false)
  })

  it('a status with a quick run shows it', () => {
    const status = toTimedRunStatus({ activeUntil: null, quickRun: { duration: 30, unit: 'min' }, lastFetchedAt: 1 })
    expect(quickRunToShow(status)).toEqual({ duration: 30, unit: 'min' })
  })

  it('quickRun null (device gone / type without a timed run) shows nothing', () => {
    expect(quickRunToShow(toTimedRunStatus({ activeUntil: null, quickRun: null, lastFetchedAt: 1 }))).toBeNull()
  })

  it('an unanswered or malformed status shows nothing', () => {
    expect(quickRunToShow(null)).toBeNull()
    expect(toTimedRunStatus('x')).toBeNull()
    expect(quickRunToShow(toTimedRunStatus({ quickRun: { duration: -1, unit: 'min' } }))).toBeNull()
    expect(quickRunToShow(toTimedRunStatus({ quickRun: { duration: 5, unit: 'h' } }))).toBeNull()
  })
})

describe('remaining time', () => {
  it('counts down to zero and is null while nothing is armed', () => {
    expect(remainingSeconds(null, 0)).toBeNull()
    expect(remainingSeconds(10_500, 0)).toBe(11)
    expect(remainingSeconds(1_000, 5_000)).toBe(0)
  })
  it('formats m:ss and h:mm:ss', () => {
    expect(formatRemaining(0)).toBe('0:00')
    expect(formatRemaining(723)).toBe('12:03')
    expect(formatRemaining(3725)).toBe('1:02:05')
  })
})

describe('refusal', () => {
  it('a refused run keeps its reason, in words', () => {
    const out = toTimedRunOutcome({ ok: false, reason: 'over-max', maxSeconds: 60 })
    expect(out).toEqual({ ok: false, reason: 'over-max' })
    expect(refusalMessageKey('over-max')).toBe('v2.accessories.timedRun.overMax')
    expect(refusalMessageKey('command-failed')).toBe('v2.accessories.timedRun.commandFailed')
    expect(refusalMessageKey('unsupported-device')).toBe('v2.accessories.timedRun.unsupported')
  })
  it('an unreadable result is a refusal, never a success', () => {
    expect(toTimedRunOutcome(undefined)).toEqual({ ok: false, reason: 'command-failed' })
    expect(toTimedRunOutcome({ ok: true, activeUntil: 5 })).toEqual({ ok: true })
  })
})
