import { describe, expect, it } from 'vitest'
import { resolveEmbedLocation } from '../use-embed-iframe.js'

describe('resolveEmbedLocation — never frame the hub from another origin', () => {
  it('on the hub (same origin) loads the hub copy, as before', () => {
    expect(
      resolveEmbedLocation({
        serverUrl: 'https://hub.example.com',
        mode: 'player',
        pageOrigin: 'https://hub.example.com',
        mountPrefix: '/viewer/dominevo/',
      }),
    ).toEqual({
      src: 'https://hub.example.com/viewer/dominevo/embed/index.html?mode=player',
      origin: 'https://hub.example.com',
    })
  })

  it('on the hosted PWA loads the bundled embed from the PWA origin', () => {
    expect(
      resolveEmbedLocation({
        serverUrl: 'https://hub.example.com:4443/',
        mode: 'grid',
        pageOrigin: 'https://dominevo.app',
        mountPrefix: '/',
      }),
    ).toEqual({
      src: 'https://dominevo.app/embed/index.html?mode=grid',
      origin: 'https://dominevo.app',
    })
  })

  it('a hub build reached on another address uses its own served copy', () => {
    expect(
      resolveEmbedLocation({
        serverUrl: 'https://tunnel.example.com',
        mode: 'events',
        pageOrigin: 'http://192.0.2.10:4480',
        mountPrefix: '/viewer/dominevo/',
      }).src,
    ).toBe('http://192.0.2.10:4480/viewer/dominevo/embed/index.html?mode=events')
  })
})
