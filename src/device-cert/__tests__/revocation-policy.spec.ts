import { describe, expect, it } from 'vitest'
import { DEFINITIVE_DEVICE_REFUSALS, DEVICE_DEFINITIVE_REFUSALS_BEFORE_DELETE } from '@camstack/types/client'
import { judgeAnswer, isDefinitiveReason } from '../revocation-policy.js'

describe('revocation counter', () => {
  it('deletes only on the third consecutive definitive refusal', () => {
    let count = 0
    const verdicts = Array.from({ length: DEVICE_DEFINITIVE_REFUSALS_BEFORE_DELETE }, () => {
      const v = judgeAnswer(count, { kind: 'refusal', reason: 'revoked' })
      count = v.count
      return v.deleteCredential
    })
    expect(verdicts).toEqual([false, false, true])
  })

  it('every exported definitive reason counts, and nothing else does', () => {
    for (const reason of DEFINITIVE_DEVICE_REFUSALS) expect(isDefinitiveReason(reason)).toBe(true)
    for (const reason of ['rate-limited', 'unavailable', 'nonce-invalid', 'expired', 'superseded', 'bad-signature', 'whatever'])
      expect(judgeAnswer(2, { kind: 'refusal', reason })).toEqual({ count: 0, deleteCredential: false })
  })

  it('an unreachable hub neither counts nor resets', () => {
    expect(judgeAnswer(2, { kind: 'unreachable' })).toEqual({ count: 2, deleteCredential: false })
  })

  it('a success resets', () => {
    expect(judgeAnswer(2, { kind: 'success' })).toEqual({ count: 0, deleteCredential: false })
  })
})
