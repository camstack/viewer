import { describe, expect, it } from 'vitest'

import {
  EMBEDDED_BY_VIEWER_SCRIPT,
  frameTargetOf,
  handoffUrl,
  parseHandoffPath,
  planAdminFrame,
  shouldOfferLocalSwitch,
} from '../admin-frame.js'

describe('how the Admin is framed', () => {
  it('native: a WebView signed in by a handoff', () => {
    expect(planAdminFrame({ os: 'ios', baseUrl: 'https://hub.example', pageOrigin: null })).toEqual({ kind: 'webview-handoff' })
    expect(planAdminFrame({ os: 'android', baseUrl: 'https://hub.example/', pageOrigin: null })).toEqual({ kind: 'webview-handoff' })
  })

  it('web on the hub origin: a same-origin iframe', () => {
    expect(planAdminFrame({ os: 'web', baseUrl: 'https://hub.example/', pageOrigin: 'https://hub.example' })).toEqual({
      kind: 'iframe',
      src: 'https://hub.example/',
    })
  })

  it('web elsewhere: a new tab, never an iframe the hub would refuse', () => {
    expect(planAdminFrame({ os: 'web', baseUrl: 'https://hub.example', pageOrigin: 'https://other.example' })).toEqual({
      kind: 'new-tab',
      href: 'https://hub.example/',
    })
  })
})

describe('an app served at its own path', () => {
  it('the iframe loads the app\u2019s path, not the hub root', () => {
    expect(planAdminFrame({ os: 'web', baseUrl: 'https://hub.example/', pageOrigin: 'https://hub.example', path: '/tools/' })).toEqual({
      kind: 'iframe',
      src: 'https://hub.example/tools/',
    })
  })

  it('native: a session-cookie app cannot sign a webview in, so it opens in the browser', () => {
    expect(planAdminFrame({ os: 'ios', baseUrl: 'https://hub.example', pageOrigin: null, path: '/tools', auth: 'session-cookie' })).toEqual({
      kind: 'new-tab',
      href: 'https://hub.example/tools',
    })
  })
})

describe('the browser handoff', () => {
  it('trusts only a hub handoff path, which carries a code and never a token', () => {
    expect(parseHandoffPath({ path: '/api/auth/browser-handoff?code=abc&destination=admin' })).toBe(
      '/api/auth/browser-handoff?code=abc&destination=admin',
    )
    expect(parseHandoffPath({ path: 'https://evil.example/x' })).toBeNull()
    expect(parseHandoffPath({ path: '/api/other?code=1' })).toBeNull()
    expect(parseHandoffPath(null)).toBeNull()
    expect(parseHandoffPath({})).toBeNull()
  })

  it('is loaded from the base the race won', () => {
    expect(handoffUrl('https://hub.example/', '/api/auth/browser-handoff?code=abc')).toBe(
      'https://hub.example/api/auth/browser-handoff?code=abc',
    )
  })

  it('marks the page as framed by the viewer before it loads', () => {
    expect(EMBEDDED_BY_VIEWER_SCRIPT).toContain('__DOMINEVO_VIEWER_EMBED__')
  })
})

describe('offering the faster route', () => {
  it('only when the route became local on another base; never when nothing changed', () => {
    expect(shouldOfferLocalSwitch(false, true, 'https://remote', 'http://192.168.1.2')).toBe(true)
    expect(shouldOfferLocalSwitch(true, true, 'http://192.168.1.2', 'http://192.168.1.2')).toBe(false)
    expect(shouldOfferLocalSwitch(false, false, 'https://remote', 'https://remote')).toBe(false)
    expect(shouldOfferLocalSwitch(true, false, 'http://192.168.1.2', 'https://remote')).toBe(false)
  })
})

describe('an addon-page app entry', () => {
  it('is framed at the admin SPA addon route, signed in by a handoff', () => {
    const target = frameTargetOf({ kind: 'addon-page', pageId: 'homematic-ccu' })
    expect(target).toEqual({ path: '/addon/homematic-ccu', auth: 'handoff', openAfterHandoff: '/addon/homematic-ccu' })
    if (target === null) throw new Error('no target')
    expect(planAdminFrame({ os: 'ios', baseUrl: 'http://hub', pageOrigin: null, path: target.path, auth: target.auth })).toEqual({
      kind: 'webview-handoff',
    })
    expect(planAdminFrame({ os: 'web', baseUrl: 'http://hub', pageOrigin: 'http://hub', path: target.path, auth: target.auth })).toEqual({
      kind: 'iframe',
      src: 'http://hub/addon/homematic-ccu',
    })
  })

  it('a web entry keeps its own path; a native entry is not framed', () => {
    expect(frameTargetOf({ kind: 'web', path: '/x', auth: 'session-cookie' })).toEqual({ path: '/x', auth: 'session-cookie', openAfterHandoff: null })
    expect(frameTargetOf({ kind: 'native', route: '/cameras' })).toBeNull()
  })
})
