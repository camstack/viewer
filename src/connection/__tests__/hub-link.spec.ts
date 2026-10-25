import { describe, it, expect } from 'vitest'
import { parseHubOrigin, sameHubOrigin, serverDisplayName } from '../hub-origin.js'
import { decideHubLink, hubParamOf, withoutHubParam, type HubLinkServer } from '../hub-link.js'

describe('parseHubOrigin — the link domain\'s rule', () => {
  it.each([
    ['https://hub.example.com', 'https://hub.example.com'],
    ['https://hub.example.com/', 'https://hub.example.com'],
    ['  https://hub.example.com:4443  ', 'https://hub.example.com:4443'],
    ['https://HUB.example.com', 'https://hub.example.com'],
  ])('accepts %s', (raw, origin) => {
    expect(parseHubOrigin(raw)).toBe(origin)
  })

  it.each([
    'http://hub.example.com',
    'javascript:alert(1)',
    'camstack://hub',
    'https://user:pass@hub.example.com',
    'https://hub.example.com/viewer',
    'https://hub.example.com/?x=1',
    'https://hub.example.com/#frag',
    'hub.example.com',
    '',
    '   ',
  ])('refuses %s', (raw) => {
    expect(parseHubOrigin(raw)).toBeNull()
  })

  it('refuses a non-string', () => {
    expect(parseHubOrigin(undefined)).toBeNull()
    expect(parseHubOrigin(['https://a.example.com'])).toBeNull()
  })

  it('compares saved URLs by origin and names them by host', () => {
    expect(sameHubOrigin('https://a.example.com/', 'https://a.example.com')).toBe(true)
    expect(sameHubOrigin('http://a.example.com', 'https://a.example.com')).toBe(false)
    expect(sameHubOrigin('not a url', 'not a url')).toBe(false)
    expect(serverDisplayName('https://a.example.com:4443/')).toBe('a.example.com:4443')
  })
})

const A: HubLinkServer = { id: 'https://a.example.com', serverUrl: 'https://a.example.com', signedIn: true }
const B: HubLinkServer = { id: 'https://b.example.com/', serverUrl: 'https://b.example.com/', signedIn: true }

describe('decideHubLink — offer, never overwrite', () => {
  it('nothing to offer for a missing or refused hub', () => {
    expect(decideHubLink({ hub: undefined, servers: [A], activeServerId: A.id })).toEqual({ kind: 'invalid' })
    expect(decideHubLink({ hub: 'http://b.example.com', servers: [A], activeServerId: A.id })).toEqual({
      kind: 'invalid',
    })
  })

  it('the active, signed-in server is already where the link points', () => {
    expect(decideHubLink({ hub: 'https://a.example.com', servers: [A, B], activeServerId: A.id })).toEqual({
      kind: 'active',
    })
  })

  it('a saved, signed-in, inactive server is OFFERED as a switch', () => {
    expect(decideHubLink({ hub: 'https://b.example.com', servers: [A, B], activeServerId: A.id })).toEqual({
      kind: 'switch',
      serverId: B.id,
      serverUrl: B.serverUrl,
    })
  })

  it('an unknown hub opens the login prefilled with its origin', () => {
    expect(decideHubLink({ hub: 'https://c.example.com', servers: [A], activeServerId: A.id })).toEqual({
      kind: 'sign-in',
      serverUrl: 'https://c.example.com',
    })
  })

  it('a saved server without a session (even the active one) opens the login', () => {
    const signedOut = { ...A, signedIn: false }
    expect(decideHubLink({ hub: 'https://a.example.com', servers: [signedOut], activeServerId: A.id })).toEqual({
      kind: 'sign-in',
      serverUrl: A.serverUrl,
    })
  })

  it('works with nothing saved (logged out, fresh install)', () => {
    expect(decideHubLink({ hub: 'https://a.example.com', servers: [], activeServerId: null })).toEqual({
      kind: 'sign-in',
      serverUrl: 'https://a.example.com',
    })
  })
})

describe('hub param helpers', () => {
  it('reads a single hub param and refuses a repeated one', () => {
    expect(hubParamOf({ hub: 'https://a.example.com' })).toBe('https://a.example.com')
    expect(hubParamOf({ hub: ['https://a', 'https://b'] })).toBeNull()
    expect(hubParamOf({})).toBeNull()
  })

  it('strips only the hub param', () => {
    expect(withoutHubParam('/camera/101?at=1&hub=https%3A%2F%2Fb')).toBe('/camera/101?at=1')
    expect(withoutHubParam('/events?hub=https%3A%2F%2Fb')).toBe('/events')
    expect(withoutHubParam('/events')).toBe('/events')
  })
})
