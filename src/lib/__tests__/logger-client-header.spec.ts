/**
 * The `client` header of a shipped log batch (planning#413): platform, app
 * version and a per-launch session id, every field a token the hub accepts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildClientHeader,
  configureLogShipping,
  flushLogsNow,
  log,
  sanitizeClientToken,
  setClientIdentity,
} from '../logger.js'

const TOKEN = /^[\w.+:@/-]{1,64}$/

describe('client header', () => {
  afterEach(() => {
    configureLogShipping(null)
    vi.unstubAllGlobals()
  })

  it('the shipped batch carries a client object with valid tokens and no user', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    setClientIdentity({ platform: 'ios', appVersion: '1.0.681' })
    configureLogShipping({ serverUrl: 'https://hub.example/', token: 't' })
    log.error('client-header-spec', 'something failed')
    await flushLogsNow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://hub.example/addon/stream-broker/clientlog/')
    const body = JSON.parse(init.body as string)
    expect(body.source).toBe('app')
    expect(body.client.platform).toBe('ios')
    expect(body.client.appVersion).toBe('1.0.681')
    expect(body.client.sessionId).toMatch(TOKEN)
    expect(body.client).not.toHaveProperty('user')
    expect(body.entries.length).toBeGreaterThan(0)
  })

  it('a weird version string is sanitised', () => {
    setClientIdentity({ platform: 'android', appVersion: '1.0 beta (7)<script>' + 'x'.repeat(100) })
    const { appVersion } = buildClientHeader()
    expect(appVersion).toMatch(TOKEN)
    expect(appVersion).not.toMatch(/[ ()<>]/)
    expect(appVersion!.length).toBeLessThanOrEqual(64)
  })

  it('an unknown platform or empty version is left out, not sent invalid', () => {
    setClientIdentity({ platform: 'windows', appVersion: '   ' })
    const header = buildClientHeader()
    expect(header).not.toHaveProperty('platform')
    expect(header).not.toHaveProperty('appVersion')
    expect(header.sessionId).toMatch(TOKEN)
  })

  it('the session id is stable within a launch and sanitising drops non-strings', () => {
    expect(buildClientHeader().sessionId).toBe(buildClientHeader().sessionId)
    expect(sanitizeClientToken(42)).toBeUndefined()
  })
})
