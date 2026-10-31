import { describe, expect, it } from 'vitest'
import { buildPublicLink } from '../track-share.js'
import { publicEndpointOf } from '../use-hub-public-endpoint.js'

const target = { path: '/events', queryParams: { trackId: 't1', deviceId: '7', ts: '1000' } }

describe('buildPublicLink', () => {
  it('joins public base, web viewer base, path and query', () => {
    expect(buildPublicLink('https://hub.example.com', target)).toBe(
      'https://hub.example.com/viewer/camstack/events?trackId=t1&deviceId=7&ts=1000',
    )
  })
  it('tolerates trailing slashes and a path without a leading slash', () => {
    expect(buildPublicLink('https://hub.example.com:8443//', { ...target, path: 'events' })).toBe(
      'https://hub.example.com:8443/viewer/camstack/events?trackId=t1&deviceId=7&ts=1000',
    )
  })
  it('omits the ? with no params', () => {
    expect(buildPublicLink('https://h.io', { path: '/events', queryParams: {} })).toBe('https://h.io/viewer/camstack/events')
  })
  it('is null without a public endpoint', () => {
    expect(buildPublicLink(null, target)).toBeNull()
    expect(buildPublicLink('  /', target)).toBeNull()
  })
})

describe('publicEndpointOf', () => {
  it('reads roles.publicEndpoint.resolved', () => {
    expect(publicEndpointOf({ roles: { publicEndpoint: { flagged: null, resolved: 'https://a.b', source: 'auto' } } })).toBe('https://a.b')
  })
  it('is null when nothing resolved or the shape is wrong', () => {
    expect(publicEndpointOf({ roles: { publicEndpoint: { resolved: null } } })).toBeNull()
    expect(publicEndpointOf(null)).toBeNull()
    expect(publicEndpointOf({})).toBeNull()
  })
})
