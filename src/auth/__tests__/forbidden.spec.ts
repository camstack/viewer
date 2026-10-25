import { afterEach, describe, it, expect, vi } from 'vitest'
import enLocale from '../../../locales/en.json'
import itLocale from '../../../locales/it.json'
import {
  describeRefusal,
  FORBIDDEN_ROLE_REFRESH_COOLDOWN_MS,
  isForbiddenError,
  NOT_FOR_YOUR_ACCOUNT_KEY,
  refusalAwareKey,
  setForbiddenHandler,
  signalForbidden,
} from '../forbidden.js'
import { isUnauthorizedError } from '../unauthorized.js'

/**
 * A hub `FORBIDDEN` is the scope gate working. It must be told apart from
 * `UNAUTHORIZED` (session gone → sign out) with no overlap in either
 * direction: a scope refusal that signed the operator out would be a far worse
 * bug than the missing gate that caused it.
 */
describe('isForbiddenError', () => {
  it('matches the tRPC client shape (err.data.code)', () => {
    expect(isForbiddenError({ data: { code: 'FORBIDDEN' } })).toBe(true)
  })

  it('matches the full server shape (err.shape.data.code)', () => {
    expect(isForbiddenError({ shape: { data: { code: 'FORBIDDEN' } } })).toBe(true)
  })

  it('matches a transport that flattened the code into the message', () => {
    expect(isForbiddenError(new Error('FORBIDDEN: device 102 is not in scope'))).toBe(true)
  })

  it('ignores anything else', () => {
    expect(isForbiddenError(null)).toBe(false)
    expect(isForbiddenError(undefined)).toBe(false)
    expect(isForbiddenError('FORBIDDEN')).toBe(false)
    expect(isForbiddenError(new Error('network request failed'))).toBe(false)
    expect(isForbiddenError({ data: { code: 'NOT_FOUND' } })).toBe(false)
  })

  it('never overlaps with the sign-out detector, in either direction', () => {
    const forbidden = { data: { code: 'FORBIDDEN' } }
    const unauthorized = { data: { code: 'UNAUTHORIZED' } }
    expect(isForbiddenError(forbidden)).toBe(true)
    expect(isUnauthorizedError(forbidden)).toBe(false)
    expect(isForbiddenError(unauthorized)).toBe(false)
    expect(isUnauthorizedError(unauthorized)).toBe(true)
  })
})

describe('describeRefusal', () => {
  it('names the call and carries the hub reason', () => {
    expect(describeRefusal(new Error('device 102 not in scope'), 'query v2/ptz')).toBe(
      'query v2/ptz: device 102 not in scope',
    )
  })

  it('still names the call when the error carries no message', () => {
    expect(describeRefusal({}, 'mutation snooze')).toBe('mutation snooze: FORBIDDEN')
    expect(describeRefusal(null, 'mutation snooze')).toBe('mutation snooze: FORBIDDEN')
  })
})

describe('a refusal re-asks the role, bounded by a cool-down', () => {
  afterEach(() => setForbiddenHandler(null))

  it('runs the handler once per cool-down, and again after it', () => {
    const handler = vi.fn()
    setForbiddenHandler(handler)
    signalForbidden(1_000)
    signalForbidden(1_000 + FORBIDDEN_ROLE_REFRESH_COOLDOWN_MS - 1)
    expect(handler).toHaveBeenCalledTimes(1)
    signalForbidden(1_000 + FORBIDDEN_ROLE_REFRESH_COOLDOWN_MS)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('is a no-op with no handler wired', () => {
    expect(() => signalForbidden()).not.toThrow()
  })
})

describe('refusalAwareKey — what a refused action tells the person', () => {
  it('a FORBIDDEN says "not available for your account", never the generic failure', () => {
    expect(refusalAwareKey({ data: { code: 'FORBIDDEN' } }, 'v2.tracks.assignFailed')).toBe(NOT_FOR_YOUR_ACCOUNT_KEY)
  })

  it('any other failure keeps its own message', () => {
    expect(refusalAwareKey(new Error('boom'), 'v2.tracks.assignFailed')).toBe('v2.tracks.assignFailed')
  })

  it('the sentence exists in both locales', () => {
    expect(enLocale.v2.access.notForYourAccount).toBe('Not available for your account')
    expect(itLocale.v2.access.notForYourAccount).toBe('Non disponibile per il tuo account')
  })
})
