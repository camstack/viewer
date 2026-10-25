import { describe, expect, it } from 'vitest'
import { resolveEnrollTarget } from '../enroll-target.js'
import { optionalModule } from '../optional-module.js'

const SAVED = [{ id: 'home', label: 'Home', serverUrl: 'https://hub.example.com' }]
const base = { servers: SAVED, signedInServerUrl: null, lastServerUrl: null }

describe('what an enrollment link must show before it can start', () => {
  it('names the hub by display name and origin, and does not warn for a saved one', () => {
    const t = resolveEnrollTarget({ ...base, linkHub: 'https://hub.example.com' })
    expect(t).toMatchObject({ status: 'ready', name: 'hub.example.com', origin: 'https://hub.example.com', isNewHub: false, knownServerId: 'home' })
  })

  it('warns when the hub is not one this device knows', () => {
    const t = resolveEnrollTarget({ ...base, linkHub: 'https://evil.example.net' })
    expect(t).toMatchObject({ status: 'ready', isNewHub: true, knownServerId: null, name: 'evil.example.net' })
  })

  it('says what it would replace when the device is signed in', () => {
    const t = resolveEnrollTarget({ ...base, linkHub: 'https://hub.example.com', signedInServerUrl: 'https://other.example.com' })
    expect(t).toMatchObject({ replacesSignInTo: 'other.example.com' })
  })

  it('refuses plain http and non-origins, and a link with no hub and no current hub', () => {
    expect(resolveEnrollTarget({ ...base, linkHub: 'http://hub.example.com' })).toEqual({ status: 'unresolved', reason: 'invalid-hub' })
    expect(resolveEnrollTarget({ ...base, linkHub: 'https://hub.example.com/path?x=1' })).toEqual({ status: 'unresolved', reason: 'invalid-hub' })
    expect(resolveEnrollTarget({ ...base, linkHub: null })).toEqual({ status: 'unresolved', reason: 'no-hub' })
  })
})

describe('optional native modules', () => {
  it('a module the binary lacks is null, not a crash', () => {
    expect(optionalModule(() => { throw new Error('Cannot find native module') })).toBeNull()
    expect(optionalModule(() => 7)).toBe(7)
  })
})
