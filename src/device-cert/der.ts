/**
 * A minimal DER reader: just enough ASN.1 to read an X.509 certificate on the
 * phone, in plain JS (no WebCrypto, no native module, so it ships as an OTA).
 * Every read is bounds-checked and throws `DerError` on malformed input.
 */
export class DerError extends Error {}

/**
 * Hermes (the phone's JS engine) has no `TextDecoder` and, on some builds, no
 * `atob`; everything below is plain JS so the reader behaves the same on the
 * phone as under Node.
 */
export function latin1Decode(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(byte)
  return out
}

/** Lenient UTF-8: a malformed sequence becomes U+FFFD, never an exception. */
export function utf8Decode(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i] ?? 0
    const extra = b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : 0
    if (b >= 0x80 && extra === 0) {
      out += '\ufffd'
      i += 1
      continue
    }
    let code = extra === 0 ? b : b & (0x3f >> extra)
    let ok = i + extra < bytes.length
    for (let k = 1; ok && k <= extra; k += 1) {
      const cont = bytes[i + k] ?? 0
      if ((cont & 0xc0) !== 0x80) ok = false
      else code = code * 64 + (cont & 0x3f)
    }
    if (!ok || code > 0x10ffff) {
      out += '\ufffd'
      i += 1
      continue
    }
    out += String.fromCodePoint(code)
    i += extra + 1
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard base64 (padding optional) to bytes; throws `DerError` on a bad character. */
export function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '')
  if (clean.length % 4 === 1) throw new DerError('bad base64')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let acc = 0
  let bits = 0
  let o = 0
  for (const ch of clean) {
    const v = B64.indexOf(ch)
    if (v < 0) throw new DerError('bad base64')
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o] = (acc >> bits) & 0xff
      o += 1
    }
  }
  return out
}

export interface Tlv {
  /** Full tag byte (class + constructed bit + number). */
  readonly tag: number
  /** The content bytes. */
  readonly body: Uint8Array
}

export const TAG = {
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  oid: 0x06,
  utf8: 0x0c,
  printable: 0x13,
  t61: 0x14,
  ia5: 0x16,
  utcTime: 0x17,
  generalizedTime: 0x18,
  sequence: 0x30,
  set: 0x31,
  /** [0] constructed (version), [3] constructed (extensions). */
  ctx0: 0xa0,
  ctx3: 0xa3,
  /** [6] primitive: a SAN uniformResourceIdentifier. */
  uri: 0x86,
} as const

/** Read the TLV at `offset`; returns it with the offset just past it. */
function readOne(bytes: Uint8Array, offset: number): { readonly tlv: Tlv; readonly next: number } {
  const tag = bytes[offset]
  const first = bytes[offset + 1]
  if (tag === undefined || first === undefined) throw new DerError('truncated header')
  let length = first
  let cursor = offset + 2
  if (first & 0x80) {
    const count = first & 0x7f
    if (count === 0 || count > 4) throw new DerError('unsupported length')
    length = 0
    for (let i = 0; i < count; i += 1) {
      const byte = bytes[cursor + i]
      if (byte === undefined) throw new DerError('truncated length')
      length = length * 256 + byte
    }
    cursor += count
  }
  const end = cursor + length
  if (end > bytes.length) throw new DerError('content overruns its parent')
  return { tlv: { tag, body: bytes.subarray(cursor, end) }, next: end }
}

/** The children of a constructed value, in order. */
export function children(parent: Tlv): readonly Tlv[] {
  const out: Tlv[] = []
  let offset = 0
  while (offset < parent.body.length) {
    const { tlv, next } = readOne(parent.body, offset)
    out.push(tlv)
    offset = next
  }
  return out
}

/** Parse a buffer that holds exactly one value. */
export function parseDer(bytes: Uint8Array): Tlv {
  const { tlv, next } = readOne(bytes, 0)
  if (next !== bytes.length) throw new DerError('trailing bytes')
  return tlv
}

export function expectTag(tlv: Tlv | undefined, tag: number): Tlv {
  if (tlv === undefined || tlv.tag !== tag) throw new DerError(`expected tag 0x${tag.toString(16)}`)
  return tlv
}

export function decodeOid(body: Uint8Array): string {
  const first = body[0]
  if (first === undefined) throw new DerError('empty OID')
  const parts: number[] = [Math.floor(first / 40), first % 40]
  let value = 0
  for (let i = 1; i < body.length; i += 1) {
    const byte = body[i] ?? 0
    value = value * 128 + (byte & 0x7f)
    if (!(byte & 0x80)) {
      parts.push(value)
      value = 0
    }
  }
  return parts.join('.')
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const STRING_TAGS: ReadonlySet<number> = new Set([TAG.utf8, TAG.printable, TAG.t61, TAG.ia5])

export function decodeString(tlv: Tlv): string {
  if (!STRING_TAGS.has(tlv.tag)) throw new DerError('not a string')
  return tlv.tag === TAG.utf8 ? utf8Decode(tlv.body) : latin1Decode(tlv.body)
}

/** UTCTime / GeneralizedTime to epoch ms. */
export function decodeTime(tlv: Tlv): number {
  const text = latin1Decode(tlv.body)
  const long = tlv.tag === TAG.generalizedTime
  const match = (long ? /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/ : /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/).exec(text)
  if (match === null) throw new DerError('unreadable time')
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number)
  const year = long ? (y ?? 0) : (y ?? 0) >= 50 ? 1900 + (y ?? 0) : 2000 + (y ?? 0)
  return Date.UTC(year, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0)
}
