/**
 * One rule for every notification editor's Save: it waits until it KNOWS who
 * is saving and which targets are his, because both decide which stored
 * targets survive (`target-ownership.ts`). An errored read is never guessed
 * either way (Task 12 fix rounds 2–3).
 */
import { describe, expect, it } from 'vitest'
import { saveBlockReason, targetsReadState } from '../save-gate.js'

describe('saveBlockReason', () => {
  it('nothing blocks a known role with an answered list', () => {
    expect(saveBlockReason('admin', 'answered')).toBeUndefined()
    expect(saveBlockReason('not-admin', 'answered')).toBeUndefined()
  })
  it('a FAILED read is named before a pending one — it will not fix itself', () => {
    expect(saveBlockReason('unknown', 'pending')).toBe('role-unknown')
    expect(saveBlockReason('pending', 'failed')).toBe('targets-failed')
    expect(saveBlockReason('unknown', 'failed')).toBe('role-unknown')
  })
  it('a pending read blocks too', () => {
    expect(saveBlockReason('pending', 'answered')).toBe('role-pending')
    expect(saveBlockReason('admin', 'pending')).toBe('targets-pending')
  })
})

describe('targetsReadState', () => {
  it('an answer is answered, even beside a later error', () => {
    expect(targetsReadState({ data: [], isError: true })).toBe('answered')
  })
  it('no answer and an error is failed; no answer yet is pending', () => {
    expect(targetsReadState({ data: undefined, isError: true })).toBe('failed')
    expect(targetsReadState({ data: undefined, isError: false })).toBe('pending')
  })
})
