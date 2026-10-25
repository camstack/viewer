import { describe, expect, it } from 'vitest'
import { enrollSelf, enrollWithCode } from '../enrollment.js'
import { switchToCertificateSession } from '../switch-session.js'
import { CHALLENGE, DAY, HUB_KEY, LOGIN_OK, TARGET, rig, scriptedHub, type Rig } from './helpers.js'

const NOW = 1_000_000
const ISSUED: unknown = {
  ok: true,
  credentialId: 'cred-9',
  certPem: 'PEM-A',
  chainPem: 'chain',
  notAfter: NOW + 365 * DAY,
  user: { id: 'u1', username: 'wife' },
}
const REQ = { target: TARGET, deviceName: 'Phone', platform: 'ios' as const }
const OLD = { token: 'old-tok', refreshToken: 'old-refresh' }

interface Seen {
  installed: string[]
  ended: string[]
}

async function runSwitch(r: Rig): Promise<{ outcome: string; seen: Seen }> {
  const seen: Seen = { installed: [], ended: [] }
  const outcome = await switchToCertificateSession({
    deps: r.deps,
    targets: [TARGET],
    captureOld: async () => OLD,
    install: async (s) => void seen.installed.push(s.token),
    endOld: async (o) => void seen.ended.push(o.token),
  })
  return { outcome, seen }
}

const loginHub = (login: () => unknown) => ({
  'auth.completeEnrollment': () => ISSUED,
  'auth.enrollSelf': () => ISSUED,
  'auth.getDeviceChallenge': () => CHALLENGE(),
  'auth.loginWithDeviceCertificate': login,
})

describe.each([
  ['admin QR code', (r: Rig) => enrollWithCode(r.deps, { ...REQ, code: 'c' })],
  ['self enrollment', (r: Rig) => enrollSelf(r.deps, { ...REQ, bearer: 'old-tok', proof: 'p' })],
])('switching after %s', (_name, enroll) => {
  it('installs the certificate session first, then ends the old one; autoLogin stays on', async () => {
    const hub = scriptedHub(loginHub(() => LOGIN_OK(NOW + 365 * DAY)))
    const r = rig(hub.fetchFn, () => NOW)
    expect((await enroll(r)).status).toBe('enrolled')
    const order: string[] = []
    const outcome = await switchToCertificateSession({
      deps: r.deps,
      targets: [TARGET],
      captureOld: async () => OLD,
      install: async () => void order.push('install'),
      endOld: async () => void order.push('end'),
    })
    expect(outcome).toBe('switched')
    expect(order).toEqual(['install', 'end'])
    expect(hub.calls.map((c) => c.procedure)).toContain('auth.loginWithDeviceCertificate')
    expect((await r.store.get(HUB_KEY))?.autoLogin).toBe(true)
  })

  it('is not blocked by the automatic re-login cooldown', async () => {
    const hub = scriptedHub(loginHub(() => LOGIN_OK(NOW + 365 * DAY)))
    const r = rig(hub.fetchFn, () => NOW)
    await enroll(r)
    const record = await r.store.get(HUB_KEY)
    if (record !== null) await r.store.put(HUB_KEY, { ...record, lastAutoReloginAt: NOW - 1000 })
    const { outcome, seen } = await runSwitch(r)
    expect(outcome).toBe('switched')
    expect(seen).toEqual({ installed: ['tok'], ended: ['old-tok'] })
  })

  it('keeps the old session, ends nothing, when the certificate sign-in fails', async () => {
    const hub = scriptedHub(loginHub(() => new Error('offline')))
    const r = rig(hub.fetchFn, () => NOW)
    await enroll(r)
    const { outcome, seen } = await runSwitch(r)
    expect(outcome).toBe('kept')
    expect(seen).toEqual({ installed: [], ended: [] })
    expect((await r.store.get(HUB_KEY))?.autoLogin).toBe(true)
  })

  it('keeps the old session when the hub refuses the certificate', async () => {
    const hub = scriptedHub(loginHub(() => ({ ok: false, reason: 'rate-limited', definitive: false })))
    const r = rig(hub.fetchFn, () => NOW)
    await enroll(r)
    const { outcome, seen } = await runSwitch(r)
    expect(outcome).toBe('kept')
    expect(seen.ended).toEqual([])
  })
})

describe('switching, edge cases', () => {
  it('keeps the old session when installing the new one throws', async () => {
    const r = rig(scriptedHub(loginHub(() => LOGIN_OK(NOW + 365 * DAY))).fetchFn, () => NOW)
    await enrollWithCode(r.deps, { ...REQ, code: 'c' })
    const ended: string[] = []
    const outcome = await switchToCertificateSession({
      deps: r.deps,
      targets: [TARGET],
      captureOld: async () => OLD,
      install: async () => {
        throw new Error('disk')
      },
      endOld: async (o) => void ended.push(o.token),
    })
    expect(outcome).toBe('kept')
    expect(ended).toEqual([])
  })

  it('a failing logout of the old session does not undo the switch', async () => {
    const r = rig(scriptedHub(loginHub(() => LOGIN_OK(NOW + 365 * DAY))).fetchFn, () => NOW)
    await enrollWithCode(r.deps, { ...REQ, code: 'c' })
    const outcome = await switchToCertificateSession({
      deps: r.deps,
      targets: [TARGET],
      captureOld: async () => OLD,
      install: async () => undefined,
      endOld: async () => {
        throw new Error('offline')
      },
    })
    expect(outcome).toBe('switched')
  })
})
