import { describe, it, expect } from 'vitest'
import { createPaintLogSampler, shouldLogPaint, SLOW_PAINT_MS } from '../snapshot-paint-log.js'

describe('snapshot paint logging — slow paints only', () => {
  it('logs every slow paint', () => {
    const sample = createPaintLogSampler()
    expect(sample(SLOW_PAINT_MS, null)).toBe(true)
    expect(sample(SLOW_PAINT_MS + 5_000, null)).toBe(true)
  })

  it('never logs a healthy paint, however many there are, nor an old frame painted fast', () => {
    const sample = createPaintLogSampler()
    let logged = 0
    for (let i = 0; i < 10_000; i += 1) {
      if (sample(40, 1_000)) logged += 1
      if (sample(40, 600_000)) logged += 1
    }
    expect(logged).toBe(0)
  })

  it('the app-wide gate follows the same rule', () => {
    expect(shouldLogPaint(SLOW_PAINT_MS - 1, null)).toBe(false)
    expect(shouldLogPaint(SLOW_PAINT_MS, null)).toBe(true)
  })
})
