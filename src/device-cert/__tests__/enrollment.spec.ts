import { describe, expect, it } from 'vitest'
import { keyAliasFor } from '../cert-store.js'
import { deviceTarget } from '../transport.js'
import { enrollByCodeAndSignIn, enrollSelf, enrollWithCode, proofFromHandoff, proofFromPassword } from '../enrollment.js'
import { CHALLENGE, DAY, HUB, HUB_KEY, LOGIN_OK, TARGET, enrolled, refusal, rig, scriptedHub, trpcError } from './helpers.js'

const NOW = 1_000_000
const ISSUED = (certPem = 'PEM-A'): unknown => ({
  ok: true,
  credentialId: 'cred-9',
  certPem,
  chainPem: 'chain',
  notAfter: NOW + 365 * DAY,
  user: { id: 'u1', username: 'wife' },
})
const REQ = { target: TARGET, deviceName: "Wife's iPhone", platform: 'ios' as const }

describe('enrollment by QR code', () => {
  it('generates the key on the device, sends only the public half, stores the certificate', async () => {
    const hub = scriptedHub({ 'auth.completeEnrollment': () => ISSUED() })
    const r = rig(hub.fetchFn, () => NOW)
    const out = await enrollWithCode(r.deps, { ...REQ, code: 'code-1' })
    expect(out).toMatchObject({ status: 'enrolled', username: 'wife' })
    expect(hub.calls[0]?.input).toEqual({ code: 'code-1', publicKeySpki: 'spki-1', deviceName: "Wife's iPhone", platform: 'ios' })
    expect(await r.store.get(HUB_KEY)).toMatchObject({ certPem: 'PEM-A', credentialId: 'cred-9', definitiveRefusals: 0 })
  })

  it('leaves nothing behind when the code is refused', async () => {
    const hub = scriptedHub({ 'auth.completeEnrollment': () => refusal('code-invalid') })
    const r = rig(hub.fetchFn)
    expect(await enrollWithCode(r.deps, { ...REQ, code: 'bad' })).toEqual({ status: 'refused', reason: 'code-invalid' })
    expect(r.keys.aliases.size).toBe(0)
    expect(await r.store.get(HUB_KEY)).toBeNull()
  })

  it('leaves nothing behind when the network drops', async () => {
    const r = rig(scriptedHub({ 'auth.completeEnrollment': () => new Error('offline') }).fetchFn)
    expect((await enrollWithCode(r.deps, { ...REQ, code: 'c' })).status).toBe('failed')
    expect(r.keys.aliases.size).toBe(0)
  })

  it('then signs in with the new certificate for the first session', async () => {
    const hub = scriptedHub({
      'auth.completeEnrollment': () => ISSUED(),
      'auth.getDeviceChallenge': () => CHALLENGE(),
      'auth.loginWithDeviceCertificate': () => LOGIN_OK(NOW + 365 * DAY),
    })
    const r = rig(hub.fetchFn, () => NOW)
    const out = await enrollByCodeAndSignIn(r.deps, { ...REQ, code: 'c' })
    expect(out.status).toBe('signed-in')
    expect(r.keys.signed).toHaveLength(1)
  })
})

describe('self enrollment (step-up)', () => {
  it('sends the single-use proof as the signed-in bearer', async () => {
    const hub = scriptedHub({ 'auth.enrollSelf': () => ISSUED('PEM-S') })
    const r = rig(hub.fetchFn, () => NOW)
    const out = await enrollSelf(r.deps, { ...REQ, bearer: 'tok', proof: 'proof-1' })
    expect(out.status).toBe('enrolled')
    expect(hub.calls[0]?.input).toMatchObject({ proof: 'proof-1', publicKeySpki: 'spki-1' })
    expect(r.keys.aliases.has(`${keyAliasFor(HUB_KEY)}.0`)).toBe(true)
  })

  it('a hub with self-enrollment off refuses by name and leaves nothing', async () => {
    const r = rig(scriptedHub({ 'auth.enrollSelf': () => refusal('self-enrollment-disabled') }).fetchFn)
    expect(await enrollSelf(r.deps, { ...REQ, bearer: 't', proof: 'p' })).toEqual({ status: 'refused', reason: 'self-enrollment-disabled' })
    expect(r.keys.aliases.size).toBe(0)
  })

  it('password step-up: reauthenticate, then trade the token for a proof', async () => {
    const hub = scriptedHub({
      'auth.reauthenticate': (i) => (typeof i === 'object' && i !== null && 'password' in i && i.password === 'pw' ? { reauthToken: 'rt-1' } : trpcError(401, 'Invalid password')),
      'auth.deviceEnrollProofFromReauth': () => ({ proof: 'proof-9', expiresAt: NOW + 300_000 }),
    })
    const r = rig(hub.fetchFn)
    expect(await proofFromPassword(r.deps, { serverUrl: HUB, bearer: 'tok', password: 'pw' })).toEqual({ kind: 'ok', value: 'proof-9' })
    expect(hub.calls[1]?.input).toEqual({ reauthToken: 'rt-1' })
    expect((await proofFromPassword(r.deps, { serverUrl: HUB, bearer: 'tok', password: 'no' })).kind).toBe('transient')
  })

  it('handoff step-up: redeems code + verifier + state for a proof', async () => {
    const hub = scriptedHub({ 'auth.deviceEnrollProofFromHandoff': () => ({ proof: 'proof-h', expiresAt: NOW + 1 }) })
    const r = rig(hub.fetchFn)
    const out = await proofFromHandoff(r.deps, { serverUrl: HUB, bearer: 'tok', code: 'c', codeVerifier: 'v', state: 's' })
    expect(out).toEqual({ kind: 'ok', value: 'proof-h' })
    expect(hub.calls[0]?.input).toEqual({ code: 'c', codeVerifier: 'v', state: 's' })
  })
})

describe('a dead session during the step-up', () => {
  it('a 401 on the handoff redeem is "session ended", not a retryable blip', async () => {
    const hub = scriptedHub({ 'auth.deviceEnrollProofFromHandoff': () => trpcError(401, 'UNAUTHORIZED') })
    const r = rig(hub.fetchFn)
    const out = await proofFromHandoff(r.deps, { serverUrl: HUB, bearer: 'dead', code: 'c', codeVerifier: 'v', state: 's' })
    expect(out).toMatchObject({ kind: 'refused', reason: 'session-ended', definitive: false })
  })

  it('a wrong password stays a plain failure: reauthenticate is not session-bound', async () => {
    const r = rig(scriptedHub({ 'auth.reauthenticate': () => trpcError(401, 'Invalid password') }).fetchFn)
    expect((await proofFromPassword(r.deps, { serverUrl: HUB, bearer: 'tok', password: 'no' })).kind).toBe('transient')
  })

  it('enrollSelf under a dead session refuses by name and leaves nothing', async () => {
    const r = rig(scriptedHub({ 'auth.enrollSelf': () => trpcError(401, 'UNAUTHORIZED') }).fetchFn)
    expect(await enrollSelf(r.deps, { ...REQ, bearer: 'dead', proof: 'p' })).toEqual({ status: 'refused', reason: 'session-ended' })
    expect(r.keys.aliases.size).toBe(0)
  })
})

describe('a failed enrollment never touches the credential that works', () => {
  const base = keyAliasFor(HUB_KEY)

  it('a refusal deletes only the spare key; the old key and record stay', async () => {
    const hub = scriptedHub({ 'auth.completeEnrollment': () => refusal('code-invalid') })
    const r = rig(hub.fetchFn, () => NOW)
    await enrolled(r)
    const before = await r.store.get(HUB_KEY)
    expect((await enrollWithCode(r.deps, { ...REQ, code: 'bad' })).status).toBe('refused')
    expect(await r.store.get(HUB_KEY)).toEqual(before)
    expect([...r.keys.aliases]).toEqual([base])
  })

  it('a dropped network keeps it too', async () => {
    const r = rig(scriptedHub({ 'auth.completeEnrollment': () => new Error('offline') }).fetchFn)
    await enrolled(r)
    expect((await enrollWithCode(r.deps, { ...REQ, code: 'c' })).status).toBe('failed')
    expect([...r.keys.aliases]).toEqual([base])
    expect((await r.store.get(HUB_KEY))?.certPem).toBe('PEM-1')
  })

  it('on success the record points at the new slot and the old key goes only afterwards', async () => {
    const hub = scriptedHub({ 'auth.completeEnrollment': () => ISSUED('PEM-NEW') })
    const r = rig(hub.fetchFn, () => NOW)
    await enrolled(r)
    expect((await enrollWithCode(r.deps, { ...REQ, code: 'c' })).status).toBe('enrolled')
    expect(await r.store.get(HUB_KEY)).toMatchObject({ certPem: 'PEM-NEW', keyAlias: `${base}.0` })
    expect([...r.keys.aliases]).toEqual([`${base}.0`])
    // The next one alternates slots, so it can never overwrite the live key.
    const again = scriptedHub({ 'auth.completeEnrollment': () => ISSUED('PEM-NEWER') })
    const r2 = { ...r, deps: { ...r.deps, fetchFn: again.fetchFn } }
    await enrollWithCode(r2.deps, { ...REQ, code: 'c2' })
    expect(await r.store.get(HUB_KEY)).toMatchObject({ certPem: 'PEM-NEWER', keyAlias: `${base}.1` })
    expect([...r.keys.aliases]).toEqual([`${base}.1`])
  })

  it('refuses to enroll over plain http, generating nothing', async () => {
    const r = rig(scriptedHub({}).fetchFn)
    const http = deviceTarget({ hubKey: HUB_KEY, liveUrl: 'http://hub.local' })
    expect((await enrollWithCode(r.deps, { ...REQ, target: http, code: 'c' })).status).toBe('failed')
    expect(r.keys.generated).toBe(0)
  })
})
