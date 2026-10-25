/**
 * The encoder that replaced `response.blob()` on the app side.
 *
 * Checked against Node's own `Buffer`, which is the only authority worth
 * testing a base64 encoder against — a hand-rolled one that agrees with itself
 * proves nothing.
 */
import { describe, expect, it } from 'vitest'

import { bytesToBase64 } from '../bytes-to-base64.js'

const ref = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

describe('bytesToBase64', () => {
  it('matches Buffer for every length across a chunk boundary', () => {
    // 3 * 1024 is the chunk; lengths either side of it catch a tail that leaks
    // padding into the middle of the stream, which is the classic defect.
    for (const len of [0, 1, 2, 3, 4, 5, 3071, 3072, 3073, 3074, 6145]) {
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) bytes[i] = (i * 31 + 7) & 0xff
      expect(bytesToBase64(bytes), `length ${len}`).toBe(ref(bytes))
    }
  })

  it('pads exactly like Buffer on the three tail cases', () => {
    expect(bytesToBase64(new Uint8Array([0x4d]))).toBe(ref(new Uint8Array([0x4d])))
    expect(bytesToBase64(new Uint8Array([0x4d, 0x61]))).toBe(ref(new Uint8Array([0x4d, 0x61])))
    expect(bytesToBase64(new Uint8Array([0x4d, 0x61, 0x6e]))).toBe('TWFu')
  })

  it('carries every byte value, including the high half', () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i++) bytes[i] = i
    expect(bytesToBase64(bytes)).toBe(ref(bytes))
  })

  it('handles a JPEG-sized buffer — 47 KB is the measured still', () => {
    const bytes = new Uint8Array(47_485)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff
    expect(bytesToBase64(bytes)).toBe(ref(bytes))
  })
})
