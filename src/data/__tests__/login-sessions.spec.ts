import { describe, expect, it } from 'vitest'
import { describeClient, parseLoginSessions } from '../login-sessions.js'

describe('parseLoginSessions', () => {
  it('reads the hub rows, current first then most recently used, and drops a malformed one', () => {
    const rows = parseLoginSessions([
      { id: 'a', method: 'password', createdAt: 1, lastUsedAt: 50, expiresAt: 99, client: 'curl/8', ip: '10.0.0.2', current: false, refreshable: true, userId: 'u' },
      { id: 'b', method: 'handoff', createdAt: 2, lastUsedAt: 10, expiresAt: 99, client: null, ip: null, current: true, refreshable: true, userId: 'u' },
      { id: 'c', method: 'passkey', createdAt: 3, lastUsedAt: 90, expiresAt: 99, client: null, ip: null, current: false, refreshable: false, userId: 'u' },
      { id: 7, method: 'password' },
      'nonsense',
    ])
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(rows[0]).toEqual({ id: 'b', method: 'handoff', lastUsedAt: 10, expiresAt: 99, client: null, ip: null, current: true })
  })

  it('a non-list is no rows', () => {
    expect(parseLoginSessions({ nope: true })).toEqual([])
  })
})

describe('describeClient', () => {
  it('names the native apps from their HTTP stacks', () => {
    expect(describeClient('CamStack/1 CFNetwork/1568.200.51 Darwin/24.1.0')).toEqual({ kind: 'app', os: 'iOS' })
    expect(describeClient('okhttp/4.12.0')).toEqual({ kind: 'app', os: 'Android' })
  })

  it('names a browser and its system — Edge and Chrome are not mistaken for Safari', () => {
    expect(
      describeClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'),
    ).toEqual({ kind: 'browser', browser: 'Safari', os: 'macOS' })
    expect(
      describeClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0'),
    ).toEqual({ kind: 'browser', browser: 'Edge', os: 'Windows' })
    expect(
      describeClient('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1'),
    ).toEqual({ kind: 'browser', browser: 'Chrome', os: 'iPhone' })
  })

  it('shows anything else raw and truncated, and nothing as unknown', () => {
    expect(describeClient('my-script/0.1 (a very long user agent string that keeps going)')).toEqual({
      kind: 'other',
      label: 'my-script/0.1 (a very long user agent st…',
    })
    expect(describeClient(null)).toEqual({ kind: 'unknown' })
    expect(describeClient('  ')).toEqual({ kind: 'unknown' })
  })
})
