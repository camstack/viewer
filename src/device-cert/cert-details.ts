/**
 * The details of a device certificate, read ON THE PHONE from the PEM the app
 * already keeps in its secure store — no request to the hub. Plain-JS DER
 * walk (see `der.ts`): the certificate is public, nothing here is secret.
 */
import {
  DerError,
  TAG,
  base64Decode,
  children,
  decodeOid,
  decodeString,
  decodeTime,
  expectTag,
  parseDer,
  utf8Decode,
  toHex,
  type Tlv,
} from './der.js'
import { sha256 } from './sha256.js'

export interface CertificateDetails {
  /** Upper-case hex, no separators. */
  readonly serialNumber: string
  /** SHA-256 of the DER, upper-case hex pairs joined by `:`. */
  readonly fingerprintSha256: string
  readonly subject: string
  readonly issuer: string
  /** Epoch ms. */
  readonly notBefore: number
  readonly notAfter: number
  /** `camstack:credential:*` and `camstack:user:*` URIs, and any other SAN. */
  readonly subjectAltNames: readonly string[]
  /** Friendly names (`clientAuth`) or the raw OID. */
  readonly extendedKeyUsage: readonly string[]
  /** `EC`, `RSA`, or the raw OID. */
  readonly publicKeyAlgorithm: string
  /** `P-256` …; null when the key is not EC or the curve is unknown. */
  readonly curve: string | null
  readonly signatureAlgorithm: string
}

const NAME_ATTRIBUTES: Readonly<Record<string, string>> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
}
const SIGNATURES: Readonly<Record<string, string>> = {
  '1.2.840.10045.4.3.2': 'ECDSA with SHA-256',
  '1.2.840.10045.4.3.3': 'ECDSA with SHA-384',
  '1.2.840.10045.4.3.4': 'ECDSA with SHA-512',
  '1.2.840.113549.1.1.11': 'RSA with SHA-256',
  '1.3.101.112': 'Ed25519',
}
const KEY_ALGORITHMS: Readonly<Record<string, string>> = {
  '1.2.840.10045.2.1': 'EC',
  '1.2.840.113549.1.1.1': 'RSA',
}
const CURVES: Readonly<Record<string, string>> = {
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
}
const EKUS: Readonly<Record<string, string>> = {
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
}
const OID_SAN = '2.5.29.17'
const OID_EKU = '2.5.29.37'

export type CertificateParse =
  | { readonly kind: 'ok'; readonly details: CertificateDetails }
  /** `step` names the part of the certificate that could not be read. */
  | { readonly kind: 'unreadable'; readonly step: string }

/** The FIRST certificate block (the leaf); tolerates CRLF, a chain, text around it. */
function pemToDer(pem: string): Uint8Array {
  const match = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem)
  if (match === null) throw new DerError('no certificate block')
  const b64 = (match[1] ?? '').replace(/\s+/g, '')
  if (b64.length === 0) throw new DerError('bad base64')
  return base64Decode(b64)
}

/** Runs one parsing step; a failure is re-thrown tagged with the step's name. */
function at<T>(step: string, run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof StepError) throw error
    throw new StepError(step, error instanceof Error ? error.message : String(error))
  }
}

class StepError extends Error {
  constructor(
    readonly step: string,
    detail: string,
  ) {
    super(`${step}: ${detail}`)
  }
}

function nameOf(name: Tlv): string {
  const parts: string[] = []
  for (const rdn of children(expectTag(name, TAG.sequence))) {
    for (const atv of children(expectTag(rdn, TAG.set))) {
      const [oid, value] = children(expectTag(atv, TAG.sequence))
      if (oid === undefined || value === undefined) throw new DerError('bad name attribute')
      const key = decodeOid(expectTag(oid, TAG.oid).body)
      parts.push(`${NAME_ATTRIBUTES[key] ?? key}=${decodeString(value)}`)
    }
  }
  return parts.join(', ')
}

function algorithmOid(seq: Tlv | undefined): { readonly oid: string; readonly param: Tlv | undefined } {
  const [oid, param] = children(expectTag(seq, TAG.sequence))
  return { oid: decodeOid(expectTag(oid, TAG.oid).body), param }
}

function extensionValues(tbsParts: readonly Tlv[]): ReadonlyMap<string, Tlv> {
  const wrapper = tbsParts.find((p) => p.tag === TAG.ctx3)
  const map = new Map<string, Tlv>()
  if (wrapper === undefined) return map
  for (const ext of children(expectTag(children(wrapper)[0], TAG.sequence))) {
    const parts = children(expectTag(ext, TAG.sequence))
    const oid = decodeOid(expectTag(parts[0], TAG.oid).body)
    const octets = expectTag(parts[parts.length - 1], TAG.octetString)
    map.set(oid, parseDer(octets.body))
  }
  return map
}

function sanOf(value: Tlv | undefined): readonly string[] {
  if (value === undefined) return []
  return children(expectTag(value, TAG.sequence)).flatMap((gn) =>
    gn.tag === TAG.uri ? [utf8Decode(gn.body)] : [],
  )
}

function ekuOf(value: Tlv | undefined): readonly string[] {
  if (value === undefined) return []
  return children(expectTag(value, TAG.sequence)).map((o) => {
    const oid = decodeOid(expectTag(o, TAG.oid).body)
    return EKUS[oid] ?? oid
  })
}

function parseOrThrow(pem: string): CertificateDetails {
  const der = at('pem', () => pemToDer(pem))
  const cert = at('certificate', () => children(expectTag(parseDer(der), TAG.sequence)))
  const tbsParts = at('tbs', () => children(expectTag(cert[0], TAG.sequence)))
  const versioned = tbsParts[0]?.tag === TAG.ctx0 ? 1 : 0
  const serial = at('serial', () => expectTag(tbsParts[versioned], TAG.integer))
  const issuer = at('issuer', () => nameOf(expectPart(tbsParts[versioned + 2])))
  const validity = at('validity', () => {
    const [from, to] = children(expectTag(tbsParts[versioned + 3], TAG.sequence))
    return { notBefore: decodeTime(expectPart(from)), notAfter: decodeTime(expectPart(to)) }
  })
  const subject = at('subject', () => nameOf(expectPart(tbsParts[versioned + 4])))
  const key = at('public key', () => {
    const spki = children(expectTag(tbsParts[versioned + 5], TAG.sequence))
    const algorithm = algorithmOid(spki[0])
    const curveOid = algorithm.param?.tag === TAG.oid ? decodeOid(algorithm.param.body) : null
    return {
      publicKeyAlgorithm: KEY_ALGORITHMS[algorithm.oid] ?? algorithm.oid,
      curve: curveOid === null ? null : (CURVES[curveOid] ?? curveOid),
    }
  })
  const signature = at('signature algorithm', () => algorithmOid(cert[1]).oid)
  const extensions = at('extensions', () => extensionValues(tbsParts))
  return {
    serialNumber: toHex(serial.body).replace(/^(00)+(?=.)/, '').toUpperCase(),
    fingerprintSha256: toHex(sha256(der))
      .toUpperCase()
      .replace(/(..)(?!$)/g, '$1:'),
    subject,
    issuer,
    ...validity,
    subjectAltNames: at('subject alt names', () => sanOf(extensions.get(OID_SAN))),
    extendedKeyUsage: at('extended key usage', () => ekuOf(extensions.get(OID_EKU))),
    ...key,
    signatureAlgorithm: SIGNATURES[signature] ?? signature,
  }
}

function expectPart(part: Tlv | undefined): Tlv {
  if (part === undefined) throw new DerError('missing field')
  return part
}

/** Never throws: malformed input is `unreadable`, naming the step that failed. */
export function parseCertificate(pem: string): CertificateParse {
  try {
    return { kind: 'ok', details: parseOrThrow(pem) }
  } catch (error) {
    return { kind: 'unreadable', step: error instanceof StepError ? error.step : 'unexpected' }
  }
}

/** Whole days from `now` to `notAfter`; negative once expired. */
export function daysUntil(notAfter: number, now: number): number {
  return Math.floor((notAfter - now) / 86_400_000)
}
