import { describe, expect, it } from 'vitest'
import {
  HubUnreachableError,
  hubHostOf,
  isBrowserNetworkFailure,
  isHubUnreachable,
  isMixedContentHub,
} from '../web-reachability.js'

describe('isMixedContentHub', () => {
  it('an https page cannot call an http hub', () => {
    expect(isMixedContentHub('https:', 'http://192.0.2.10:4480')).toBe(true)
  })
  it('https hubs, http pages and garbage are not mixed content', () => {
    expect(isMixedContentHub('https:', 'https://hub.example.com')).toBe(false)
    expect(isMixedContentHub('http:', 'http://192.0.2.10:4480')).toBe(false)
    expect(isMixedContentHub(null, 'http://192.0.2.10:4480')).toBe(false)
    expect(isMixedContentHub('https:', 'not a url')).toBe(false)
  })
})

describe('isBrowserNetworkFailure', () => {
  it.each(['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'])('%s', (m) => {
    expect(isBrowserNetworkFailure(new Error(m))).toBe(true)
  })
  it('a refusal from the hub is not a network failure', () => {
    expect(isBrowserNetworkFailure(new Error('Invalid username or password'))).toBe(false)
    expect(isBrowserNetworkFailure('Failed to fetch')).toBe(false)
  })
})

describe('isHubUnreachable', () => {
  it('a browser network failure or the bounded wait running out', () => {
    expect(isHubUnreachable(new TypeError('Failed to fetch'))).toBe(true)
    expect(isHubUnreachable(new HubUnreachableError('https://h.example'))).toBe(true)
    expect(isHubUnreachable(new Error('Invalid username or password'))).toBe(false)
  })
})

describe('hubHostOf', () => {
  it('names host and port; an unparsable input is shown as typed', () => {
    expect(hubHostOf(' https://hub.tail1234.ts.net:4443/ ')).toBe('hub.tail1234.ts.net:4443')
    expect(hubHostOf('hub without scheme')).toBe('hub without scheme')
  })
})
