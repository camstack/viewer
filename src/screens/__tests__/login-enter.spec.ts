import { describe, expect, it } from 'vitest'
import { loginEnterAction, loginReturnKey } from '../login-enter.js'

describe('login Enter / return key', () => {
  it('web: Enter submits from every field', () => {
    for (const field of ['serverUrl', 'username', 'password', 'totp'] as const) {
      expect(loginEnterAction(field, 'web')).toEqual({ kind: 'submit' })
    }
  })

  it('native: return walks the fields, the last one signs in', () => {
    expect(loginEnterAction('serverUrl', 'ios')).toEqual({ kind: 'focus', field: 'username' })
    expect(loginEnterAction('username', 'android')).toEqual({ kind: 'focus', field: 'password' })
    expect(loginEnterAction('password', 'ios')).toEqual({ kind: 'submit' })
    expect(loginEnterAction('totp', 'ios')).toEqual({ kind: 'submit' })
    expect(loginReturnKey('serverUrl')).toBe('next')
    expect(loginReturnKey('username')).toBe('next')
    expect(loginReturnKey('password')).toBe('go')
    expect(loginReturnKey('totp')).toBe('go')
  })
})
