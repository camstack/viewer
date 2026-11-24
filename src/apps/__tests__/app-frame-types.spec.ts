import { describe, expect, it } from 'vitest'

import { frameOriginOf, navigationDecision, originGuardedScript, staysInFrame } from '../app-frame-types.js'

const ORIGIN = 'http://192.168.1.20:4444'

describe('frameOriginOf', () => {
  it('is scheme + host + port of the page', () => {
    expect(frameOriginOf('http://192.168.1.20:4444/some/path?x=1')).toBe(ORIGIN)
    expect(frameOriginOf('not a url')).toBeNull()
  })
})

describe('navigationDecision', () => {
  it('keeps the frame own origin', () => {
    expect(navigationDecision('http://192.168.1.20:4444/other', ORIGIN)).toBe('stay')
    expect(navigationDecision('about:blank', ORIGIN)).toBe('stay')
  })
  it('sends another host, scheme or port to the system', () => {
    expect(navigationDecision('https://evil.example/', ORIGIN)).toBe('external')
    expect(navigationDecision('https://192.168.1.20:4444/', ORIGIN)).toBe('external')
    expect(navigationDecision('http://192.168.1.20:4445/', ORIGIN)).toBe('external')
    expect(navigationDecision('http://192.168.1.21:4444/', ORIGIN)).toBe('external')
  })
  it('is not fooled by a lookalike host', () => {
    expect(navigationDecision('http://192.168.1.20:4444@evil.example/', ORIGIN)).toBe('external')
  })
  it('blocks javascript:, data: and unparsable targets', () => {
    expect(navigationDecision('javascript:alert(1)', ORIGIN)).toBe('block')
    expect(navigationDecision('data:text/html,<b>x</b>', ORIGIN)).toBe('block')
    expect(navigationDecision('file:///etc/passwd', ORIGIN)).toBe('block')
    expect(navigationDecision('::::', ORIGIN)).toBe('block')
  })
  it('with no known origin nothing stays', () => {
    expect(staysInFrame('http://192.168.1.20:4444/', null)).toBe(false)
  })
})

describe('originGuardedScript', () => {
  it('runs the script only when location.origin is the frame origin', () => {
    const wrapped = originGuardedScript('window.x = 1; true;', ORIGIN) ?? ''
    const run = (origin: string): { x?: number } => {
      const win: { x?: number; location: { origin: string } } = { location: { origin } }
      new Function('window', wrapped)(win)
      return win
    }
    expect(run(ORIGIN).x).toBe(1)
    expect(run('https://evil.example').x).toBeUndefined()
  })
  it('is undefined without a script or an origin', () => {
    expect(originGuardedScript(undefined, ORIGIN)).toBeUndefined()
    expect(originGuardedScript('x', null)).toBeUndefined()
  })
})

describe('the native page bridge scripts', () => {
  it('delivers a shell message to the page as a message event', async () => {
    const { deliverToPageScript } = await import('../app-frame-types.js')
    const script = deliverToPageScript({ camstack: 'app-bridge', v: 1, type: 'hello' })
    expect(script).toContain("new MessageEvent('message'")
    expect(script).toContain('"type":"hello"')
  })
  it('forwards only the bridge envelope out of the page', async () => {
    const { BRIDGE_FORWARDER_SCRIPT } = await import('../app-frame-types.js')
    expect(BRIDGE_FORWARDER_SCRIPT).toContain("d.camstack === 'app-bridge'")
    expect(BRIDGE_FORWARDER_SCRIPT).toContain('ReactNativeWebView.postMessage')
  })
})
