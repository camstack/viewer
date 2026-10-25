import { describe, expect, it } from 'vitest'
import {
  assertionToJSON,
  base64UrlToBytes,
  bytesToBase64Url,
  requestOptionsFromJSON,
} from '../webauthn-assertion.js'

const bytes = (...values: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(values)

describe('base64url', () => {
  it('round-trips bytes, with no padding and the URL alphabet', () => {
    const raw = bytes(0xfb, 0xff, 0xfe, 0x01)
    const encoded = bytesToBase64Url(raw)
    expect(encoded).toBe('-__-AQ')
    expect([...base64UrlToBytes(encoded)]).toEqual([...raw])
  })
})

describe('requestOptionsFromJSON — the hub\'s options as the browser takes them', () => {
  it('decodes the challenge and every allowed credential id; keeps the rest', () => {
    const options = requestOptionsFromJSON({
      challenge: 'AQID',
      rpId: 'hub.example',
      timeout: 60000,
      userVerification: 'preferred',
      allowCredentials: [{ id: 'BAU', type: 'public-key', transports: ['internal'] }],
    })
    expect([...new Uint8Array(options.challenge as ArrayBuffer)]).toEqual([1, 2, 3])
    expect(options.rpId).toBe('hub.example')
    expect(options.timeout).toBe(60000)
    expect(options.userVerification).toBe('preferred')
    const allowed = options.allowCredentials?.[0]
    expect([...new Uint8Array(allowed?.id as ArrayBuffer)]).toEqual([4, 5])
    expect(allowed?.transports).toEqual(['internal'])
  })

  it('refuses options without a challenge', () => {
    expect(() => requestOptionsFromJSON({ rpId: 'x' })).toThrow()
  })
})

describe('assertionToJSON — the browser\'s answer as the hub verifies it', () => {
  it('encodes every binary field and carries the extension results', () => {
    const json = assertionToJSON({
      id: 'cred-id',
      rawId: bytes(9, 9).buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: bytes(1).buffer,
        authenticatorData: bytes(2).buffer,
        signature: bytes(3).buffer,
        userHandle: null,
      },
      getClientExtensionResults: () => ({}),
    })
    expect(json).toEqual({
      id: 'cred-id',
      rawId: bytesToBase64Url(bytes(9, 9)),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: bytesToBase64Url(bytes(1)),
        authenticatorData: bytesToBase64Url(bytes(2)),
        signature: bytesToBase64Url(bytes(3)),
      },
      clientExtensionResults: {},
    })
  })
})
