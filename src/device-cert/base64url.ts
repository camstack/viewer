/** base64url (RFC 4648 §5, no padding) over bytes, without `btoa` or `Buffer`. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1] ?? 0
    const b2 = bytes[i + 2] ?? 0
    out += ALPHABET.charAt(b0 >> 2)
    out += ALPHABET.charAt(((b0 & 3) << 4) | (b1 >> 4))
    if (i + 1 < bytes.length) out += ALPHABET.charAt(((b1 & 15) << 2) | (b2 >> 6))
    if (i + 2 < bytes.length) out += ALPHABET.charAt(b2 & 63)
  }
  return out
}
