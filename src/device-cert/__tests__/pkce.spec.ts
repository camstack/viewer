import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { challengeFor, createPkcePair, type PkcePrimitives } from '../pkce.js'
import { bytesToBase64Url } from '../base64url.js'

const nodeSha256: PkcePrimitives['sha256'] = async (bytes) => new Uint8Array(createHash('sha256').update(bytes).digest())

function counterRandom(): PkcePrimitives['randomBytes'] {
  let n = 0
  return (length) => Uint8Array.from({ length }, () => (n += 7) % 256)
}

describe('PKCE S256', () => {
  it('matches the RFC 7636 appendix B vector', async () => {
    const challenge = await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', nodeSha256)
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('derives the challenge from the verifier it returns, and keeps the shape the hub accepts', async () => {
    const pair = await createPkcePair({ randomBytes: counterRandom(), sha256: nodeSha256 })
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(pair.state).toMatch(/^[A-Za-z0-9._~-]{1,256}$/)
    expect(await challengeFor(pair.codeVerifier, nodeSha256)).toBe(pair.codeChallenge)
    expect(pair.state).not.toBe(pair.codeVerifier)
  })

  it('never reuses a verifier or a state across runs', async () => {
    const random = counterRandom()
    const a = await createPkcePair({ randomBytes: random, sha256: nodeSha256 })
    const b = await createPkcePair({ randomBytes: random, sha256: nodeSha256 })
    expect(a.codeVerifier).not.toBe(b.codeVerifier)
    expect(a.state).not.toBe(b.state)
  })

  it('base64url has no padding or unsafe characters', () => {
    expect(bytesToBase64Url(Uint8Array.from([251, 255, 254]))).toBe('-__-')
    expect(bytesToBase64Url(Uint8Array.from([1]))).toBe('AQ')
  })
})
