/**
 * Bytes → base64, without a `Blob` and without `btoa`.
 *
 * ## Why this is hand-written
 *
 * React Native's fetch cannot make a Blob out of a buffered body: calling
 * `response.blob()` on Hermes throws *"Creating blobs from 'ArrayBuffer' and
 * 'ArrayBufferView' are not supported"*, which is precisely what the operator
 * saw written across every clip card on 2026-09-21 — once the stills were
 * finally being requested at all.
 *
 * The embed does the same job with `res.blob()` + `URL.createObjectURL` and is
 * right to: it runs in a real browser inside the WebView. This module is the
 * app side, where neither exists. `btoa` is not in Hermes either, and
 * `String.fromCharCode(...bytes)` blows the argument limit on a 47 KB JPEG, so
 * the encoding is chunked and explicit.
 *
 * Pure: no React, no fetch, no platform.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * How many bytes are encoded per pass. A multiple of 3 so no pass ever splits
 * a base64 triplet across chunks — the bug every hand-rolled encoder has.
 */
const CHUNK_BYTES = 3 * 1024

/** Standard base64 with `=` padding, byte-exact for any length. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
    out += encodeChunk(bytes, start, Math.min(start + CHUNK_BYTES, bytes.length))
  }
  return out
}

function encodeChunk(bytes: Uint8Array, start: number, end: number): string {
  let out = ''
  let i = start
  for (; i + 2 < end; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out +=
      (ALPHABET[(n >> 18) & 63] ?? '') +
      (ALPHABET[(n >> 12) & 63] ?? '') +
      (ALPHABET[(n >> 6) & 63] ?? '') +
      (ALPHABET[n & 63] ?? '')
  }
  // The tail, padded. Only the LAST chunk can have one, because CHUNK_BYTES is
  // a multiple of 3 — a padded chunk in the middle would corrupt the stream.
  const left = end - i
  if (left === 1) {
    const n = (bytes[i] ?? 0) << 16
    out += (ALPHABET[(n >> 18) & 63] ?? '') + (ALPHABET[(n >> 12) & 63] ?? '') + '=='
  } else if (left === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8)
    out +=
      (ALPHABET[(n >> 18) & 63] ?? '') +
      (ALPHABET[(n >> 12) & 63] ?? '') +
      (ALPHABET[(n >> 6) & 63] ?? '') +
      '='
  }
  return out
}
