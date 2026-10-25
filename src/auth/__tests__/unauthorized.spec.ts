import { describe, expect, it } from 'vitest'
import { isUnauthorizedError } from '../unauthorized.js'

describe('isUnauthorizedError', () => {
  it('detects the tRPC data.code shape', () => {
    expect(isUnauthorizedError({ data: { code: 'UNAUTHORIZED' } })).toBe(true)
  })

  it('detects the tRPC shape.data.code shape', () => {
    expect(isUnauthorizedError({ shape: { data: { code: 'UNAUTHORIZED' } } })).toBe(true)
  })

  it('detects UNAUTHORIZED flattened into the message', () => {
    expect(isUnauthorizedError({ message: 'UNAUTHORIZED: session expired' })).toBe(true)
  })

  it('does NOT treat FORBIDDEN (permission) as a session-expiry signal', () => {
    expect(isUnauthorizedError({ data: { code: 'FORBIDDEN' } })).toBe(false)
    expect(isUnauthorizedError({ shape: { data: { code: 'FORBIDDEN' } } })).toBe(false)
  })

  it('is false for non-auth errors and non-objects', () => {
    expect(isUnauthorizedError({ data: { code: 'INTERNAL_SERVER_ERROR' } })).toBe(false)
    expect(isUnauthorizedError(new Error('network down'))).toBe(false)
    expect(isUnauthorizedError(null)).toBe(false)
    expect(isUnauthorizedError(undefined)).toBe(false)
    expect(isUnauthorizedError('UNAUTHORIZED')).toBe(false)
  })
})
