import { describe, expect, it, vi } from 'vitest'
import { daysUntil, parseCertificate } from '../cert-details.js'
import { HUB_LEAVES, HUB_LEAF_1_PEM, HUB_LEAF_2_PEM, HUB_LEAF_3_PEM } from './fixtures/hub-leaves.js'
import { LEAF_P256_PEM } from './fixtures/leaf-p256.js'
import { sha256 } from '../sha256.js'
import { toHex } from '../der.js'

const PEM = LEAF_P256_PEM

describe('parseCertificate', () => {
  it('reads every field of an EC P-256 leaf the way openssl does', () => {
    const parsed = parseCertificate(PEM)
    if (parsed.kind !== 'ok') throw new Error('expected ok')
    const d = parsed.details
    expect(d.serialNumber).toBe('79C218AF58DCCD2C5EC1F9914D0E43DA2EB2ACA0')
    expect(d.fingerprintSha256).toBe(
      'E6:27:E7:85:99:B1:A3:C1:FA:D1:0E:70:C0:BE:09:98:90:77:B5:A7:98:C5:EC:70:33:B1:BE:44:ED:65:F1:46',
    )
    expect(d.subject).toBe("CN=wife's phone, O=CamStack")
    expect(d.issuer).toBe('O=CamStack, CN=CamStack Device CA')
    expect(d.notBefore).toBe(Date.UTC(2026, 9, 16, 7, 26, 46))
    expect(d.notAfter).toBe(Date.UTC(2027, 9, 16, 7, 26, 46))
    expect(d.subjectAltNames).toEqual(['camstack:credential:cred-123', 'camstack:user:wife'])
    expect(d.extendedKeyUsage).toEqual(['clientAuth'])
    expect(d.publicKeyAlgorithm).toBe('EC')
    expect(d.curve).toBe('P-256')
    expect(d.signatureAlgorithm).toBe('ECDSA with SHA-256')
  })

  it.each(['', 'not a pem', '-----BEGIN CERTIFICATE-----\n!!!!\n-----END CERTIFICATE-----', PEM.slice(0, 200) + '\n-----END CERTIFICATE-----'])(
    'reports malformed input as unreadable instead of throwing: %#',
    (bad) => {
      expect(parseCertificate(bad)).toMatchObject({ kind: 'unreadable' })
    },
  )

  const HUB_PEMS = [HUB_LEAF_1_PEM, HUB_LEAF_2_PEM, HUB_LEAF_3_PEM]

  it.each(HUB_LEAVES.map((l, i) => [i, l] as const))('reads real hub leaf %i field by field', (i, want) => {
    const parsed = parseCertificate(HUB_PEMS[i] ?? '')
    if (parsed.kind !== 'ok') throw new Error(`unreadable: ${parsed.step}`)
    const d = parsed.details
    expect(d.serialNumber).toBe(want.serial)
    expect(d.fingerprintSha256).toBe(want.fp)
    expect(d.subject).toBe(`CN=${want.cred}`)
    expect(d.issuer).toBe('CN=CamStack Device CA')
    expect(d.notBefore).toBe(want.nb)
    expect(d.notAfter).toBe(want.na)
    expect(d.subjectAltNames).toEqual([`camstack:credential:${want.cred}`, `camstack:user:${want.user}`])
    expect(d.extendedKeyUsage).toEqual(['clientAuth'])
    expect(d.publicKeyAlgorithm).toBe('EC')
    expect(d.curve).toBe('P-256')
    expect(d.signatureAlgorithm).toBe('ECDSA with SHA-256')
  })

  it('reads the first certificate of a CRLF chain, with no TextDecoder or atob (Hermes)', () => {
    const chain = `${HUB_LEAF_1_PEM}${HUB_LEAF_2_PEM}`.replace(/\n/g, '\r\n')
    vi.stubGlobal('TextDecoder', undefined)
    vi.stubGlobal('atob', undefined)
    try {
      const parsed = parseCertificate(chain)
      if (parsed.kind !== 'ok') throw new Error(`unreadable: ${parsed.step}`)
      expect(parsed.details.serialNumber).toBe(HUB_LEAVES[0]?.serial)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('names the failing step', () => {
    expect(parseCertificate('nope')).toEqual({ kind: 'unreadable', step: 'pem' })
  })

  it('counts whole days to expiry, negative once expired', () => {
    expect(daysUntil(Date.UTC(2026, 9, 26), Date.UTC(2026, 9, 16))).toBe(10)
    expect(daysUntil(Date.UTC(2026, 9, 15), Date.UTC(2026, 9, 16))).toBeLessThan(0)
  })
})

describe('sha256', () => {
  it('matches the known vectors', () => {
    expect(toHex(sha256(new Uint8Array()))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(toHex(sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    const long = new TextEncoder().encode('a'.repeat(1000))
    expect(toHex(sha256(long))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  })
})
