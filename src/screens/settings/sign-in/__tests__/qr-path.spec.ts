/**
 * The TOTP QR is drawn from a path, not a picture: prove the path encodes a
 * real symbol (finder patterns in three corners), not just "some squares".
 */
import { describe, expect, it } from 'vitest'
import { qrPath } from '../qr-path.js'

describe('qrPath', () => {
  const url = 'otpauth://totp/CamStack:operator?secret=JBSWY3DPEHPK3PXP&issuer=CamStack'
  const { size, d } = qrPath(url)

  it('is a square symbol of a legal QR size', () => {
    expect((size - 17) % 4).toBe(0)
    expect(size).toBeGreaterThanOrEqual(21)
  })

  it('draws the three finder patterns (dark corners) and a light quiet gap', () => {
    const cells = new Set(d.split('z').filter((c) => c.length > 0))
    const dark = (col: number, row: number): boolean => cells.has(`M${col} ${row}h1v1h-1`)
    expect(dark(0, 0)).toBe(true)
    expect(dark(size - 1, 0)).toBe(true)
    expect(dark(0, size - 1)).toBe(true)
    // The separator ring around a finder is always light.
    expect(dark(7, 0)).toBe(false)
    expect(dark(size - 8, 0)).toBe(false)
    expect(dark(0, size - 8)).toBe(false)
  })
})
