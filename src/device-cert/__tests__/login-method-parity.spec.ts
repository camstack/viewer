import { describe, expect, it } from 'vitest'
import { fetchLoginMethods, offersDeviceCertificate, primaryBrowserArms, viewsFromWire } from '../login-methods.js'

describe('login method arms (D858)', () => {
  it('shows a browser arm with its start path, hides null arms and second-factor arms', () => {
    const views = viewsFromWire([
      { kind: 'redirect', id: 'oidc', label: 'Authentik', stage: 'primary', app: { kind: 'browser', startPath: '/addon/auth-oidc/oidc/start' } },
      { kind: 'passkey', id: 'pk', label: 'Passkey', stage: 'primary', app: { kind: 'browser', startPath: '/auth/app/passkey' } },
      { kind: 'passkey', id: 'pk2', label: 'Passkey 2FA', stage: 'second-factor', app: null },
      { kind: 'widget', id: 'w', label: 'Widget', stage: 'primary', app: null },
      { kind: 'device-certificate', id: 'device-certificate', label: 'This device', stage: 'primary', app: { kind: 'native' }, clients: ['native'] },
    ])
    expect(primaryBrowserArms(views).map((v) => [v.id, v.startPath])).toEqual([
      ['oidc', '/addon/auth-oidc/oidc/start'],
      ['pk', '/auth/app/passkey'],
    ])
    expect(offersDeviceCertificate(views)).toBe(true)
  })

  it('an older hub (no app field) offers no browser arm: the admin login is never the fallback', () => {
    const views = viewsFromWire([
      { kind: 'redirect', id: 'oidc', label: 'Authentik', stage: 'primary', startUrl: '/x' },
      { kind: 'passkey', id: 'pk', label: 'Passkey', stage: 'primary' },
      'junk',
    ])
    expect(views).toHaveLength(2)
    expect(primaryBrowserArms(views)).toEqual([])
  })

  it('a malformed app field is hidden, not trusted', () => {
    const views = viewsFromWire([{ kind: 'redirect', id: 'o', stage: 'primary', app: { kind: 'browser' } }])
    expect(primaryBrowserArms(views)).toEqual([])
  })

  it('reads the list from the hub, and says null when it cannot', async () => {
    const ok = await fetchLoginMethods('https://hub', async () =>
      new Response(JSON.stringify({ result: { data: { json: [{ kind: 'redirect', id: 'o', label: 'O', stage: 'primary' }] } } })),
    )
    expect(ok?.map((v) => v.id)).toEqual(['o'])
    expect(await fetchLoginMethods('https://hub', async () => new Response('', { status: 404 }))).toBeNull()
    expect(await fetchLoginMethods('https://hub', async () => { throw new Error('offline') })).toBeNull()
  })
})
