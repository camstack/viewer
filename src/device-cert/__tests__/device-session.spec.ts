import { describe, expect, it } from 'vitest'
import { DEVICE_CERT_RENEW_WINDOW_DAYS } from '@camstack/types/client'
import { keyAliasFor } from '../cert-store.js'
import {
  AUTO_RELOGIN_COOLDOWN_MS,
  disconnectThisDevice,
  isRenewalDue,
  loginWithCertificate,
  renewIfDue,
  setAutoLogin,
} from '../device-session.js'
import { deviceTarget } from '../transport.js'
import { CHALLENGE, DAY, HUB_KEY, LOGIN_OK, ORIGIN, TARGET, enrolled, refusal, rig, scriptedHub, trpcError } from './helpers.js'

const NOW = 1_000_000

describe('login with the certificate', () => {
  it('signs the login message for the origin the hub named and opens a session', async () => {
    const hub = scriptedHub({
      'auth.getDeviceChallenge': () => CHALLENGE('nonce-7'),
      'auth.loginWithDeviceCertificate': () => LOGIN_OK(NOW + 300 * DAY),
    })
    const r = rig(hub.fetchFn)
    await enrolled(r)
    const out = await loginWithCertificate(r.deps, TARGET)
    expect(out.status).toBe('signed-in')
    expect(r.keys.signed).toEqual([`camstack-device-cert-v1\nlogin\n${ORIGIN}\nnonce-7`])
    const login = hub.calls.find((c) => c.procedure === 'auth.loginWithDeviceCertificate')
    expect(login?.input).toMatchObject({ certPem: 'PEM-1', nonce: 'nonce-7', signature: 'sig-1', refreshable: true })
  })

  it('says none when this device holds no certificate', async () => {
    const r = rig(scriptedHub({}).fetchFn)
    expect(await loginWithCertificate(r.deps, TARGET)).toEqual({ status: 'none' })
  })

  it('refuses a challenge that names another origin, signing nothing', async () => {
    const hub = scriptedHub({
      'auth.getDeviceChallenge': () => ({ ...CHALLENGE(), origin: 'https://evil.example.com' }),
    })
    const r = rig(hub.fetchFn)
    await enrolled(r, { definitiveRefusals: 2 })
    const out = await loginWithCertificate(r.deps, TARGET)
    expect(out.status).toBe('unreachable')
    expect(r.keys.signed).toEqual([])
    expect((await r.store.get(HUB_KEY))?.definitiveRefusals).toBe(2)
  })

  it('deletes key and certificate after three CONSECUTIVE definitive answers, across launches', async () => {
    const hub = scriptedHub({
      'auth.getDeviceChallenge': () => CHALLENGE(),
      'auth.loginWithDeviceCertificate': () => refusal('revoked'),
    })
    const r = rig(hub.fetchFn)
    await enrolled(r)
    expect((await loginWithCertificate(r.deps, TARGET)).status).toBe('refused')
    expect((await loginWithCertificate(r.deps, TARGET)).status).toBe('refused')
    expect(await r.store.get(HUB_KEY)).not.toBeNull()
    expect(await loginWithCertificate(r.deps, TARGET)).toEqual({ status: 'disconnected', reason: 'revoked' })
    expect(await r.store.get(HUB_KEY)).toBeNull()
    expect(r.keys.aliases.has(keyAliasFor(HUB_KEY))).toBe(false)
  })

  it('network errors, 5xx and rate limits never delete — ten in a row', async () => {
    let n = 0
    const hub = scriptedHub({
      'auth.getDeviceChallenge': () => {
        n += 1
        if (n % 3 === 0) return new Error('Network request failed')
        if (n % 3 === 1) return new Response('', { status: 503 })
        return refusal('rate-limited')
      },
    })
    const r = rig(hub.fetchFn)
    await enrolled(r, { definitiveRefusals: 2 })
    for (let i = 0; i < 10; i += 1) await loginWithCertificate(r.deps, TARGET)
    expect(await r.store.get(HUB_KEY)).not.toBeNull()
    expect(r.keys.aliases.has(keyAliasFor(HUB_KEY))).toBe(true)
  })

  it('a refusal that is not definitive resets the counter; so does a success', async () => {
    const answers: unknown[] = [refusal('revoked'), refusal('revoked'), refusal('expired'), refusal('revoked'), refusal('revoked')]
    const hub = scriptedHub({
      'auth.getDeviceChallenge': () => CHALLENGE(),
      'auth.loginWithDeviceCertificate': () => answers.shift() ?? LOGIN_OK(NOW + 300 * DAY),
    })
    const r = rig(hub.fetchFn)
    await enrolled(r)
    for (let i = 0; i < 5; i += 1) await loginWithCertificate(r.deps, TARGET)
    // revoked×2, expired (reset), revoked×2: never three in a row.
    expect(await r.store.get(HUB_KEY)).not.toBeNull()
    expect((await r.store.get(HUB_KEY))?.definitiveRefusals).toBe(2)
    expect((await loginWithCertificate(r.deps, TARGET)).status).toBe('signed-in')
    expect((await r.store.get(HUB_KEY))?.definitiveRefusals).toBe(0)
  })

  it('an UNAUTHORIZED carrying device-credential:<reason> counts like the typed answer', async () => {
    const hub = scriptedHub({
      'auth.getDeviceChallenge': () => CHALLENGE(),
      'auth.loginWithDeviceCertificate': () => trpcError(401, 'device-credential:unknown-credential'),
    })
    const r = rig(hub.fetchFn)
    await enrolled(r, { definitiveRefusals: 2 })
    expect((await loginWithCertificate(r.deps, TARGET)).status).toBe('disconnected')
  })

  it('forgets a certificate whose key is gone, without asking the hub', async () => {
    const hub = scriptedHub({})
    const r = rig(hub.fetchFn)
    await enrolled(r)
    r.keys.aliases.clear()
    expect(await loginWithCertificate(r.deps, TARGET)).toEqual({ status: 'none' })
    expect(await r.store.get(HUB_KEY)).toBeNull()
    expect(hub.calls).toEqual([])
  })

  it('superseded: fetches the newest certificate by renewing, then signs in once more', async () => {
    let logins = 0
    const hub = scriptedHub({
      'auth.getDeviceChallenge': () => CHALLENGE(),
      'auth.loginWithDeviceCertificate': () => (++logins === 1 ? refusal('superseded') : LOGIN_OK(NOW + 365 * DAY)),
      'auth.renewDeviceCertificate': () => ({ ok: true, credentialId: 'cred-1', certPem: 'PEM-2', chainPem: 'c', notAfter: NOW + 365 * DAY }),
    })
    const r = rig(hub.fetchFn)
    await enrolled(r)
    expect((await loginWithCertificate(r.deps, TARGET)).status).toBe('signed-in')
    expect((await r.store.get(HUB_KEY))?.certPem).toBe('PEM-2')
    expect((await r.store.get(HUB_KEY))?.definitiveRefusals).toBe(0)
  })
})

describe('renewal window', () => {
  it('is due strictly inside DEVICE_CERT_RENEW_WINDOW_DAYS', () => {
    const window = DEVICE_CERT_RENEW_WINDOW_DAYS * DAY
    expect(isRenewalDue(NOW + window + 1, NOW)).toBe(false)
    expect(isRenewalDue(NOW + window - 1, NOW)).toBe(true)
    expect(isRenewalDue(NOW - 1, NOW)).toBe(true)
  })

  it('does nothing outside the window', async () => {
    const hub = scriptedHub({})
    const r = rig(hub.fetchFn, () => NOW)
    await enrolled(r, { notAfter: NOW + 200 * DAY })
    expect(await renewIfDue(r.deps, TARGET)).toBe('not-due')
    expect(hub.calls).toEqual([])
  })

  it('swaps the certificate for the same key when due, signing a renew message', async () => {
    const hub = scriptedHub({
      'auth.getDeviceChallenge': () => CHALLENGE('r1'),
      'auth.renewDeviceCertificate': () => ({ ok: true, credentialId: 'cred-1', certPem: 'PEM-NEW', chainPem: 'c', notAfter: NOW + 365 * DAY }),
    })
    const r = rig(hub.fetchFn, () => NOW)
    await enrolled(r, { notAfter: NOW + 10 * DAY })
    expect(await renewIfDue(r.deps, TARGET)).toBe('renewed')
    expect(r.keys.signed[0]).toBe(`camstack-device-cert-v1\nrenew\n${ORIGIN}\nr1`)
    expect(r.keys.generated).toBe(0)
    expect(await r.store.get(HUB_KEY)).toMatchObject({ certPem: 'PEM-NEW', notAfter: NOW + 365 * DAY })
  })

  it('keeps the old certificate when renewal fails for any reason', async () => {
    for (const failing of [new Error('offline'), refusal('superseded'), refusal('revoked'), new Response('', { status: 500 })]) {
      const hub = scriptedHub({
        'auth.getDeviceChallenge': () => CHALLENGE(),
        'auth.renewDeviceCertificate': () => failing,
      })
      const r = rig(hub.fetchFn, () => NOW)
      await enrolled(r, { notAfter: NOW + 10 * DAY })
      expect(await renewIfDue(r.deps, TARGET)).toBe('kept')
      expect((await r.store.get(HUB_KEY))?.certPem).toBe('PEM-1')
      expect(r.keys.aliases.has(keyAliasFor(HUB_KEY))).toBe(true)
    }
  })

  it('a sign-in does NOT renew inline: the session comes back first, renewal is the caller\'s afterwards', async () => {
    const hub = scriptedHub({
      'auth.getDeviceChallenge': () => CHALLENGE(),
      'auth.loginWithDeviceCertificate': () => LOGIN_OK(NOW + 10 * DAY),
      'auth.renewDeviceCertificate': () => ({ ok: true, credentialId: 'cred-1', certPem: 'PEM-NEW', chainPem: 'c', notAfter: NOW + 365 * DAY }),
    })
    const r = rig(hub.fetchFn, () => NOW)
    await enrolled(r, { notAfter: NOW + 10 * DAY })
    expect((await loginWithCertificate(r.deps, TARGET)).status).toBe('signed-in')
    expect(hub.calls.some((c) => c.procedure === 'auth.renewDeviceCertificate')).toBe(false)
    expect((await r.store.get(HUB_KEY))?.certPem).toBe('PEM-1')
    expect(await renewIfDue(r.deps, TARGET)).toBe('renewed')
    expect((await r.store.get(HUB_KEY))?.certPem).toBe('PEM-NEW')
  })
})

describe('Disconnect this device', () => {
  it('revokes signed, and deletes key and certificate right after ok', async () => {
    const hub = scriptedHub({
      'auth.getDeviceChallenge': () => CHALLENGE('d1'),
      'auth.revokeOwnDeviceCertificate': () => ({ ok: true, credentialId: 'cred-1', sessionsEnded: 1 }),
    })
    const r = rig(hub.fetchFn)
    await enrolled(r)
    expect(await disconnectThisDevice(r.deps, TARGET)).toEqual({ status: 'disconnected' })
    expect(r.keys.signed[0]).toBe(`camstack-device-cert-v1\nrevoke\n${ORIGIN}\nd1`)
    expect(await r.store.get(HUB_KEY)).toBeNull()
    expect(r.keys.aliases.size).toBe(0)
  })

  it('keeps everything when the hub cannot be reached (it must not look disconnected)', async () => {
    const hub = scriptedHub({ 'auth.getDeviceChallenge': () => new Error('offline') })
    const r = rig(hub.fetchFn)
    await enrolled(r)
    expect((await disconnectThisDevice(r.deps, TARGET)).status).toBe('failed')
    expect(await r.store.get(HUB_KEY)).not.toBeNull()
    expect(r.keys.aliases.size).toBe(1)
  })
})

describe('one credential per hub, whichever route is live', () => {
  const PUBLIC = 'https://hub.public.example.org'

  it('enrolled on the LAN route, later connected through the public origin: the certificate works', async () => {
    const hub = scriptedHub({
      'auth.getDeviceChallenge': () => ({ ...CHALLENGE('p1'), origin: PUBLIC }),
      'auth.loginWithDeviceCertificate': () => LOGIN_OK(NOW + 300 * DAY),
    })
    const r = rig(hub.fetchFn)
    await enrolled(r) // filed under the hub key; hubOrigin undefined (legacy-style record)
    const viaPublic = deviceTarget({ hubKey: HUB_KEY, liveUrl: PUBLIC, knownUrls: [ORIGIN] })
    expect((await loginWithCertificate(r.deps, viaPublic)).status).toBe('signed-in')
    expect(r.keys.signed[0]).toBe(`camstack-device-cert-v1\nlogin\n${PUBLIC}\np1`)
  })

  it('the challenge may name another ADVERTISED route of the hub, and nothing else', async () => {
    const hub = scriptedHub({
      'auth.getDeviceChallenge': () => ({ ...CHALLENGE(), origin: PUBLIC }),
      'auth.loginWithDeviceCertificate': () => LOGIN_OK(NOW + 300 * DAY),
    })
    const r = rig(hub.fetchFn)
    await enrolled(r)
    // Dialled on the LAN address; the public name is not among the routes the app knows.
    expect((await loginWithCertificate(r.deps, TARGET)).status).toBe('unreachable')
    expect(r.keys.signed).toEqual([])
    // Once it is a known route of this hub, the same challenge is accepted.
    const learned = deviceTarget({ hubKey: HUB_KEY, liveUrl: ORIGIN, knownUrls: [PUBLIC] })
    expect((await loginWithCertificate(r.deps, learned)).status).toBe('signed-in')
  })
})

describe('no certificate operation over plain http', () => {
  const HTTP = deviceTarget({ hubKey: HUB_KEY, liveUrl: 'http://192.0.2.10:4443' })

  it('login, renew and disconnect touch neither the key nor the network', async () => {
    const hub = scriptedHub({})
    const r = rig(hub.fetchFn, () => NOW)
    await enrolled(r, { notAfter: NOW + 5 * DAY, definitiveRefusals: 2 })
    expect(await loginWithCertificate(r.deps, HTTP)).toEqual({ status: 'none' })
    expect(await renewIfDue(r.deps, HTTP)).toBe('not-due')
    expect((await disconnectThisDevice(r.deps, HTTP)).status).toBe('failed')
    expect(hub.calls).toEqual([])
    expect(r.keys.signed).toEqual([])
    expect((await r.store.get(HUB_KEY))?.definitiveRefusals).toBe(2)
  })
})

describe('automatic sign-in cooldown', () => {
  const ok = {
    'auth.getDeviceChallenge': () => CHALLENGE(),
    'auth.loginWithDeviceCertificate': () => LOGIN_OK(NOW + 300 * DAY),
  }

  it('runs once per 10 minutes; a tap is never held back', async () => {
    let clock = NOW
    const hub = scriptedHub(ok)
    const r = rig(hub.fetchFn, () => clock)
    await enrolled(r)
    expect((await loginWithCertificate(r.deps, TARGET, { automatic: true })).status).toBe('signed-in')
    clock += AUTO_RELOGIN_COOLDOWN_MS - 1
    expect(await loginWithCertificate(r.deps, TARGET, { automatic: true })).toEqual({ status: 'none' })
    expect((await loginWithCertificate(r.deps, TARGET)).status).toBe('signed-in') // the button
    clock += 2
    expect((await loginWithCertificate(r.deps, TARGET, { automatic: true })).status).toBe('signed-in')
  })

  it('a hub that keeps ending the session is not undone within the window', async () => {
    const hub = scriptedHub(ok)
    const r = rig(hub.fetchFn, () => NOW)
    await enrolled(r, { lastAutoReloginAt: NOW - 60_000 })
    expect(await loginWithCertificate(r.deps, TARGET, { automatic: true })).toEqual({ status: 'none' })
    expect(hub.calls).toEqual([])
  })

  it('an explicit sign-out pauses it until a deliberate sign-in lifts the pause', async () => {
    const hub = scriptedHub(ok)
    const r = rig(hub.fetchFn)
    await enrolled(r)
    await setAutoLogin(r.deps, HUB_KEY, false)
    expect(await loginWithCertificate(r.deps, TARGET, { automatic: true })).toEqual({ status: 'none' })
    await setAutoLogin(r.deps, HUB_KEY, true)
    expect((await loginWithCertificate(r.deps, TARGET, { automatic: true })).status).toBe('signed-in')
  })
})
