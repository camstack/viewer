/**
 * A QR code as ONE SVG path: a unit square per dark module, on a grid of
 * `size × size`. One path element instead of one rect per module keeps the
 * render to a single native view on every platform.
 *
 * `qrcode`'s `create` is the pure encoder (no canvas, no DOM).
 */
import { create } from 'qrcode'

export interface QrPath {
  /** Modules per side; the SVG viewBox is `0 0 size size`. */
  readonly size: number
  readonly d: string
}

export function qrPath(text: string): QrPath {
  const { modules } = create(text, { errorCorrectionLevel: 'M' })
  const parts: string[] = []
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (modules.get(row, col) === 1) parts.push(`M${col} ${row}h1v1h-1z`)
    }
  }
  return { size: modules.size, d: parts.join('') }
}
